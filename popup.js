// Popup UI for Bookmark Folder Search (v0.4)
//   (empty)                 -> your bookmarks toolbar, then the other top-level folders
//   tools                   -> fuzzy search over folders and bookmarks (all words must match)
//   tools/                  -> contents of folder "tools"
//   Bookmarks Toolbar/Tools/sub/   -> go deeper (spaces are fine once a "/" is used)
//   tools/ git              -> words after the last "/" search inside that folder, recursively
// Ctrl+Shift+Enter opens every bookmark in the highlighted folder; Ctrl+D saves the current page
// into the folder you're viewing (or the highlighted folder row) and reports it in the status line.

const MAX_ROWS = 100;
const OPEN_ALL_CONFIRM_ABOVE = 10;
const DAY = 86400000;

const $q = document.getElementById("q");
const $crumb = document.getElementById("crumb");
const $list = document.getElementById("list");
const $status = document.getElementById("status");

let root, folders = [], folderPool = [], bookmarkPool = [];
let items = [], sel = 0, view = {}, usage = {}, pendingOpenAll = null;

const isFolder = n => n.type === "folder";
const termsOf = s => s.toLowerCase().split(/\s+/).filter(Boolean);
const norm = s => s.replace(/^\/+|\/+$/g, "").trim().toLowerCase();
const parentOf = path => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

// ---------- data ----------

async function load() {
  [root] = await browser.bookmarks.getTree();
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

// ---------- rendering ----------

const iconMemo = new Map();        // host -> dataURL | null
const pendingIcons = new Set();

function badge(text, cls = "") {
  const s = document.createElement("span");
  s.className = "badge " + cls;
  s.textContent = text;
  return s;
}
function imgEl(src) {
  const img = new Image(18, 18);
  img.className = "fav";
  img.alt = "";
  img.src = src;
  return img;
}
function hostOf(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname : ""; } catch { return ""; }
}
function requestIcon(host) {
  if (pendingIcons.has(host)) return;
  pendingIcons.add(host);
  browser.runtime.sendMessage({ type: "icon", host })
    .then(data => {
      iconMemo.set(host, data || null);
      if (!data) return;
      for (const b of $list.querySelectorAll(".badge[data-host]")) {
        if (b.dataset.host === host) b.replaceWith(imgEl(data));
      }
    })
    .catch(() => iconMemo.set(host, null))
    .finally(() => pendingIcons.delete(host));
}
function makeIcon(item) {
  if (item.type === "folder") return badge("📁", "folder");
  const host = hostOf(item.url);
  if (!host) return badge("•");
  const cached = iconMemo.get(host);
  if (cached) return imgEl(cached);
  const b = badge(host[0].toUpperCase());
  b.dataset.host = host;
  if (!iconMemo.has(host)) requestIcon(host);
  return b;
}

// Show the folder path relative to the folder being viewed; nothing if it's the same folder.
function shownWhere(item) {
  const base = view.folder && view.folder.path;
  if (!item.where) return "";
  if (!base) return item.where;
  if (item.where === base) return "";
  if (item.where.startsWith(base + "/")) return item.where.slice(base.length + 1);
  return item.where;
}

function buildRow(item, i) {
  const li = document.createElement("li");
  const main = document.createElement("div");
  main.className = "main";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = item.title;
  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = item.type === "folder" ? `${item.count} items` : item.url;
  main.append(title, sub);
  const where = document.createElement("span");
  where.className = "where";
  where.textContent = shownWhere(item);
  where.title = item.where;
  li.append(makeIcon(item), main, where);

  li.addEventListener("mouseenter", () => { sel = i; paint(false); });
  li.addEventListener("click", e => activate(item, e.ctrlKey || e.metaKey ? "tab" : e.shiftKey ? "bg" : "cur"));
  li.addEventListener("auxclick", e => { if (e.button === 1) activate(item, "tab"); });
  return li;
}

function currentTarget() {
  const it = items[sel];
  if (it && it.type === "folder") return { id: it.id, path: it.path };
  return view.folder || null;
}

function paint(scroll = true) {
  [...$list.children].forEach((li, i) => li.classList.toggle("sel", i === sel));
  if (scroll) $list.children[sel]?.scrollIntoView({ block: "nearest" });
}

function setStatus(msg, kind = "err") {
  $status.textContent = msg;
  $status.className = kind;
}

function render() {
  pendingOpenAll = null;
  const r = compute($q.value);
  view = r;
  items = r.items.slice(0, MAX_ROWS);

  const total = r.items.length;
  const count = `${total} ${total === 1 ? "item" : "items"}`;
  const redundant = r.crumb && norm(r.crumb) === norm($q.value);   // header would just repeat the input
  let label;
  if (r.error) label = r.crumb;
  else if (r.crumb && !redundant) label = `${r.crumb}  ·  ${count}`;
  else label = count;
  if (total > MAX_ROWS && !r.error) label += `  (showing first ${MAX_ROWS})`;
  $crumb.textContent = label;

  setStatus("", "");
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nothing here";
    $list.replaceChildren(li);
  } else {
    $list.replaceChildren(...items.map(buildRow));
  }
  sel = 0;
  paint();
}

// ---------- actions ----------

function recordUse(item) {
  const k = usageKey(item);
  const u = usage[k] || { n: 0, t: 0 };
  usage[k] = { n: u.n + 1, t: Date.now() };
  const cutoff = Date.now() - 180 * DAY;
  let entries = Object.entries(usage).filter(([, v]) => v.t > cutoff);
  if (entries.length > 3000) entries = entries.sort((a, b) => b[1].t - a[1].t).slice(0, 3000);
  usage = Object.fromEntries(entries);
  return browser.storage.local.set({ usage }).catch(() => {});
}

function enterFolder(item) {
  recordUse(item);
  $q.value = item.path + "/";
  render();
  $q.focus();
  $q.setSelectionRange($q.value.length, $q.value.length);
}

async function activate(item, how) {
  if (!item) return;
  if (item.type === "folder") return enterFolder(item);
  await recordUse(item);
  try {
    if (how === "tab") await browser.tabs.create({ url: item.url });
    else if (how === "bg") await browser.tabs.create({ url: item.url, active: false });
    else await browser.tabs.update({ url: item.url });
    if (how !== "bg") window.close();   // background tabs keep the popup open for opening several
  } catch {
    setStatus("Firefox doesn't allow extensions to open this kind of URL.");
  }
}

async function openAll(item) {
  const urls = (item.node.children || []).filter(c => c.url).map(c => c.url);
  if (!urls.length) return setStatus("No bookmarks directly inside that folder.", "warn");
  if (urls.length > OPEN_ALL_CONFIRM_ABOVE && !(pendingOpenAll && pendingOpenAll === item.id)) {
    pendingOpenAll = item.id;
    return setStatus(`Open ${urls.length} tabs? Press Ctrl+Shift+Enter again to confirm. Any other key cancels.`, "warn");
  }
  pendingOpenAll = null;
  await recordUse(item);
  let opened = 0, failed = 0;
  for (const url of urls) {
    try { await browser.tabs.create({ url, active: opened === 0 }); opened++; } catch { failed++; }
  }
  if (failed) setStatus(`Opened ${opened}. ${failed} couldn't be opened by an extension.`, "warn");
  else window.close();
}

async function saveCurrent() {
  const target = currentTarget();
  if (!target) return setStatus("Type a folder path ending in /, or highlight a folder row, first.", "warn");
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return setStatus("Couldn't read the current tab.");
    const kids = await browser.bookmarks.getChildren(target.id);
    if (kids.some(k => k.url === tab.url)) return setStatus(`Already bookmarked in ${target.path}.`, "warn");
    await browser.bookmarks.create({ parentId: target.id, title: tab.title || tab.url, url: tab.url });
    await load();
    render();
    setStatus(`Saved to ${target.path}.`, "ok");
  } catch (err) {
    setStatus("Couldn't save: " + (err && err.message ? err.message : err));
  }
}

// ---------- input ----------

const atEnd = () => $q.selectionStart === $q.value.length && $q.selectionEnd === $q.value.length;

$q.addEventListener("input", render);

document.addEventListener("keydown", e => {
  const mod = e.ctrlKey || e.metaKey;
  const isModifierKey = ["Control", "Shift", "Alt", "Meta"].includes(e.key);
  if (pendingOpenAll && !isModifierKey && !(e.key === "Enter" && mod && e.shiftKey)) {
    pendingOpenAll = null;
    setStatus("", "");
  }
  const n = items.length;
  switch (e.key) {
    case "ArrowDown": if (n) { sel = (sel + 1) % n; paint(); } e.preventDefault(); break;
    case "ArrowUp":   if (n) { sel = (sel - 1 + n) % n; paint(); } e.preventDefault(); break;
    case "Enter":
      e.preventDefault();
      if (mod && e.shiftKey && items[sel]?.type === "folder") openAll(items[sel]);
      else activate(items[sel], mod ? "tab" : e.shiftKey ? "bg" : "cur");
      break;
    case "Tab":
      if (items[sel]?.type === "folder") enterFolder(items[sel]);
      e.preventDefault();
      break;
    case "ArrowRight":
      if (atEnd() && items[sel]?.type === "folder") { enterFolder(items[sel]); e.preventDefault(); }
      break;
    case "ArrowLeft":
      if (atEnd() && $q.value.endsWith("/")) {
        $q.value = $q.value.replace(/[^/]*\/$/, "");
        render();
        e.preventDefault();
      }
      break;
    case "d": case "D":
      if (mod) { e.preventDefault(); saveCurrent(); }
      break;
    case "Escape": window.close(); break;
  }
});

// Firefox popups don't always hand focus to the input right away, so ask several times.
const focusInput = () => { $q.focus(); $q.select(); };
Promise.all([load(), loadUsage()]).then(() => { render(); focusInput(); });
focusInput();
document.addEventListener("DOMContentLoaded", focusInput);
window.addEventListener("load", focusInput);
setTimeout(focusInput, 30);
setTimeout(focusInput, 120);
