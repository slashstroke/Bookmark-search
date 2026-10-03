// Shared search logic, loaded before popup.js (popup) and background.js (address-bar mode).
//   (empty)                 -> the bookmarks toolbar, then the other top-level folders
//   tools                   -> fuzzy search over folders and bookmarks (all words must match)
//   tools/                  -> contents of folder "tools"
//   Bookmarks Toolbar/Tools/sub/   -> go deeper (spaces are fine once a "/" is used)
//   tools/ git              -> words after the last "/" search inside that folder, recursively

const DAY = 86400000;
let root, folders = [], folderPool = [], bookmarkPool = [], usage = {};

const isFolder = n => n.type === "folder";
const termsOf = s => s.toLowerCase().split(/\s+/).filter(Boolean);
const norm = s => s.replace(/^\/+|\/+$/g, "").trim().toLowerCase();
const parentOf = path => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

// ---------- data ----------

function buildIndex(tree) {
  root = tree;
  folders = [];
  (function walk(node, path) {
    if (!isFolder(node)) return;
    const isRoot = node === root;
    const here = isRoot ? [] : [...path, node.title];
    if (!isRoot) folders.push({ path: here.join("/"), name: node.title, node });
    for (const c of node.children || []) walk(c, here);
  })(root, []);
  folderPool = folders.map(f => folderItem(f.node, parentOf(f.path)));
  bookmarkPool = collect(root, "").map(bookmarkItem);
}

async function loadUsage() {
  try { usage = (await browser.storage.local.get("usage")).usage || {}; } catch { usage = {}; }
}

function collect(node, prefix) {
  const out = [];
  for (const c of node.children || []) {
    if (c.url) out.push({ title: c.title || c.url, url: c.url, rel: prefix });
    else if (isFolder(c)) out.push(...collect(c, `${prefix}${c.title}/`));
  }
  return out;
}

const folderItem = (c, base) => ({
  type: "folder", id: c.id, node: c, title: c.title,
  path: base ? `${base}/${c.title}` : c.title, count: (c.children || []).length, where: base
});
const bookmarkItem = b => ({ type: "bookmark", title: b.title, url: b.url, where: b.rel.replace(/\/$/, "") });

// ---------- fuzzy ranking ----------

const isBoundary = (s, i) => i === 0 || /[^a-z0-9]/.test(s[i - 1]);

// Exact substring: strong match. Starts of words and of the string score higher.
function substringScore(term, s) {
  let best = -1, from = 0, i;
  while ((i = s.indexOf(term, from)) >= 0) {
    let sc = 100 + (term.length / s.length) * 30;
    if (i === 0) sc += 40; else if (isBoundary(s, i)) sc += 25;
    if (sc > best) best = sc;
    from = i + 1;
  }
  if (best >= 0 && s === term) best += 50;
  return best;
}

// Subsequence ("hkr" -> "HackerRank"): weaker, titles only; starts at a word start and stays compact.
function subseqScore(term, s) {
  if (term.length < 2) return -1;
  let best = -1;
  for (let start = s.indexOf(term[0]); start >= 0; start = s.indexOf(term[0], start + 1)) {
    if (!isBoundary(s, start)) continue;          // must begin at the start of a word
    let ti = 1, last = start, sc = 4;
    for (let i = start + 1; i < s.length && ti < term.length; i++) {
      if (s[i] === term[ti]) {
        sc += 1 + (i === last + 1 ? 2 : 0) + (isBoundary(s, i) ? 3 : 0);
        last = i; ti++;
      }
    }
    if (ti === term.length) {
      const span = last - start + 1;
      if (span <= term.length * 2 + 2) best = Math.max(best, 20 + sc - (span - term.length));
    }
  }
  return best;
}

function lc(it) {
  if (!it._lc) it._lc = { t: it.title.toLowerCase(), u: (it.url || "").toLowerCase(), w: (it.where || "").toLowerCase() };
  return it._lc;
}

function termScore(term, it) {
  const f = lc(it);
  let best = substringScore(term, f.t);
  if (best < 0) best = subseqScore(term, f.t);
  if (f.u) { const u = substringScore(term, f.u); if (u >= 0) best = Math.max(best, u * 0.6); }
  if (f.w) { const w = substringScore(term, f.w); if (w >= 0) best = Math.max(best, w * 0.4); }
  return best;
}

// Items you open often (and recently) float up. Capped so a good text match still wins.
const usageKey = it => (it.type === "folder" ? "f:" + it.id : "b:" + it.url);
function boost(it) {
  const u = usage[usageKey(it)];
  if (!u) return 0;
  const days = (Date.now() - u.t) / DAY;
  return Math.min(50, 10 * Math.log2(1 + u.n)) * Math.max(0.25, Math.pow(0.5, days / 30));
}

function rank(list, terms) {
  const out = [];
  list.forEach((it, idx) => {
    let total = 0;
    for (const t of terms) {
      const s = termScore(t, it);
      if (s < 0) return;
      total += s;
    }
    if (it.type === "folder") total += 10;
    out.push({ it, total: total + boost(it), idx });
  });
  out.sort((a, b) => b.total - a.total || a.idx - b.idx);
  return out.map(o => o.it);
}

// ---------- views ----------

function pickFolder(query) {
  const q = query.toLowerCase();
  const score = f => (f.name.toLowerCase() === q ? 0 : f.path.toLowerCase().endsWith(q) ? 1 : 2);
  return folders.filter(f => f.path.toLowerCase().includes(q))
    .sort((a, b) => score(a) - score(b) || a.path.length - b.path.length)[0] || null;
}

function childMatch(parent, seg) {
  const q = seg.toLowerCase();
  const kids = (parent.children || []).filter(isFolder);
  return kids.find(c => c.title.toLowerCase() === q)
      || kids.find(c => c.title.toLowerCase().startsWith(q))
      || kids.find(c => c.title.toLowerCase().includes(q)) || null;
}

function compute(raw) {
  const text = raw.replace(/^\/+/, "");
  const top = root.children || [];
  const rootFolders = () => top.filter(isFolder).map(c => folderItem(c, ""));

  if (!text.trim()) {
    const bar = top.find(c => c.id === "toolbar_____") || top.find(isFolder);
    if (!bar) return { crumb: "All bookmarks", items: rootFolders() };
    const barItems = (bar.children || [])
      .map(c => c.url ? bookmarkItem({ title: c.title || c.url, url: c.url, rel: bar.title + "/" })
                      : isFolder(c) ? folderItem(c, bar.title) : null)
      .filter(Boolean);
    const others = top.filter(c => isFolder(c) && c !== bar && (c.children || []).length)
      .map(c => folderItem(c, ""));
    return { crumb: bar.title + "/", items: [...barItems, ...others], folder: { id: bar.id, path: bar.title } };
  }

  if (!text.includes("/")) {
    return { crumb: null, items: rank([...folderPool, ...bookmarkPool], termsOf(text)) };
  }

  const parts = text.split("/");
  const terms = termsOf(parts.pop());
  const segs = parts.map(s => s.trim()).filter(Boolean);
  if (!segs.length) return { crumb: "All bookmarks", items: rootFolders() };

  const first = pickFolder(segs[0]);
  if (!first) return { crumb: `No folder matches "${segs[0]}"`, items: [], error: true };

  let node = first.node, base = first.path;
  for (const seg of segs.slice(1)) {
    const next = childMatch(node, seg);
    if (!next) {
      return {
        crumb: `No subfolder "${seg}" in ${base}/`, error: true,
        items: (node.children || []).filter(isFolder).map(c => folderItem(c, base))
      };
    }
    node = next;
    base += "/" + next.title;
  }

  const kids = node.children || [];
  const folder = { id: node.id, path: base };
  if (terms.length) {
    const pool = [
      ...kids.filter(isFolder).map(c => folderItem(c, base)),
      ...collect(node, base + "/").map(bookmarkItem)
    ];
    return { crumb: base + "/", items: rank(pool, terms), folder };
  }
  const subs = kids.filter(isFolder).map(c => folderItem(c, base));
  const marks = kids.filter(c => c.url)
    .map(c => bookmarkItem({ title: c.title || c.url, url: c.url, rel: base + "/" }));
  return { crumb: base + "/", items: [...subs, ...marks], folder };
}

// Count an open/enter so frequently used items rank higher. Re-reads storage first so the popup
// and the address-bar mode don't overwrite each other's counts.
async function recordUse(item) {
  const k = usageKey(item);
  try {
    const cur = (await browser.storage.local.get("usage")).usage || {};
    const u = cur[k] || { n: 0, t: 0 };
    cur[k] = { n: u.n + 1, t: Date.now() };
    const cutoff = Date.now() - 180 * DAY;
    let entries = Object.entries(cur).filter(([, v]) => v.t > cutoff);
    if (entries.length > 3000) entries = entries.sort((x, y) => y[1].t - x[1].t).slice(0, 3000);
    usage = Object.fromEntries(entries);
    await browser.storage.local.set({ usage });
  } catch {}
}
