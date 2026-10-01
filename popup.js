// Popup UI for Bookmark Folder Search.
//   (empty)              -> top-level folders
//   tools                -> search folders + bookmarks by name (all words must match)
//   tools/               -> contents of folder "tools"
//   Bookmarks Toolbar/tools/sub/   -> go deeper (spaces fine once a "/" is used)
//   tools/ git           -> words after the last "/" filter inside that folder (recursively)

// Favicon source. Only each bookmark's hostname is requested. Set to null to disable icons.
const ICON_URL = host => `https://icons.duckduckgo.com/ip3/${host}.ico`;
const MAX_ROWS = 100;

const $q = document.getElementById("q");
const $crumb = document.getElementById("crumb");
const $list = document.getElementById("list");
const $status = document.getElementById("status");

let root, folders = [], allBookmarks = [], items = [], sel = 0;

const isFolder = n => n.type === "folder";
const termsOf = s => s.toLowerCase().split(/\s+/).filter(Boolean);
const matchTerms = (hay, terms) => terms.every(t => hay.includes(t));

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
  allBookmarks = collect(root, "");
}

function collect(node, prefix) {
  const out = [];
  for (const c of node.children || []) {
    if (c.url) out.push({ title: c.title || c.url, url: c.url, rel: prefix });
    else if (isFolder(c)) out.push(...collect(c, `${prefix}${c.title}/`));
  }
  return out;
}

const parentOf = path => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

const folderItem = (c, base) => ({
  type: "folder", title: c.title, path: base ? `${base}/${c.title}` : c.title,
  count: (c.children || []).length, where: base
});
const bookmarkItem = b => ({ type: "bookmark", title: b.title, url: b.url, where: b.rel.replace(/\/$/, "") });

function pickFolder(query) {
  const q = query.toLowerCase();
  const score = f => {
    if (f.name.toLowerCase() === q) return 0;
    if (f.path.toLowerCase().endsWith(q)) return 1;
    return 2;
  };
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
  const rootFolders = () => (root.children || []).filter(isFolder).map(c => folderItem(c, ""));

  if (!text.trim()) return { crumb: "All bookmarks", items: rootFolders() };

  if (!text.includes("/")) {
    const terms = termsOf(text);
    const fs = folders
      .filter(f => matchTerms(f.name.toLowerCase(), terms))
      .sort((a, b) => {
        const r = f => (f.name.toLowerCase() === terms.join(" ") ? 0 : f.name.toLowerCase().startsWith(terms[0]) ? 1 : 2);
        return r(a) - r(b) || a.path.length - b.path.length;
      })
      .map(f => ({ ...folderItem(f.node, parentOf(f.path)) }));
    const bs = allBookmarks
      .filter(b => matchTerms(`${b.title} ${b.url} ${b.rel}`.toLowerCase(), terms))
      .map(bookmarkItem);
    return { crumb: `Search: ${text.trim()}`, items: [...fs, ...bs] };
  }

  const parts = text.split("/");
  const terms = termsOf(parts.pop());
  const segs = parts.map(s => s.trim()).filter(Boolean);
  if (!segs.length) return { crumb: "All bookmarks", items: rootFolders() };

  const first = pickFolder(segs[0]);
  if (!first) return { crumb: `No folder matches "${segs[0]}"`, items: [] };

  let node = first.node, base = first.path;
  for (const seg of segs.slice(1)) {
    const next = childMatch(node, seg);
    if (!next) {
      return {
        crumb: `No subfolder "${seg}" in ${base}/`,
        items: (node.children || []).filter(isFolder).map(c => folderItem(c, base))
      };
    }
    node = next;
    base += "/" + next.title;
  }

  const kids = node.children || [];
  const subs = kids
    .filter(c => isFolder(c) && matchTerms(c.title.toLowerCase(), terms))
    .map(c => folderItem(c, base));
  const marks = (terms.length
      ? collect(node, base + "/")
      : kids.filter(c => c.url).map(c => ({ title: c.title || c.url, url: c.url, rel: base + "/" })))
    .filter(b => matchTerms(`${b.title} ${b.url}`.toLowerCase(), terms))
    .map(bookmarkItem);
  return { crumb: base + "/", items: [...subs, ...marks] };
}

// ---------- rendering ----------

function badge(text, cls = "") {
  const s = document.createElement("span");
  s.className = "badge " + cls;
  s.textContent = text;
  return s;
}

function makeIcon(item) {
  if (item.type === "folder") return badge("📁", "folder");
  let host = "";
  try {
    const u = new URL(item.url);
    if (/^https?:$/.test(u.protocol)) host = u.hostname;
  } catch {}
  if (!host || !ICON_URL) return badge((host || "•")[0].toUpperCase());
  const img = document.createElement("img");
  img.className = "fav";
  img.width = img.height = 18;
  img.alt = "";
  img.src = ICON_URL(host);
  img.addEventListener("error", () => img.replaceWith(badge(host[0].toUpperCase())));
  return img;
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
  where.textContent = item.where;
  where.title = item.where;
  li.append(makeIcon(item), main, where);

  li.addEventListener("mouseenter", () => { sel = i; paint(false); });
  li.addEventListener("click", e => activate(item, e.ctrlKey || e.metaKey ? "tab" : e.shiftKey ? "bg" : "cur"));
  li.addEventListener("auxclick", e => { if (e.button === 1) activate(item, "tab"); });
  return li;
}

function paint(scroll = true) {
  [...$list.children].forEach((li, i) => li.classList.toggle("sel", i === sel));
  if (scroll) $list.children[sel]?.scrollIntoView({ block: "nearest" });
}

function render() {
  const r = compute($q.value);
  items = r.items.slice(0, MAX_ROWS);
  $crumb.textContent = r.crumb + (r.items.length > MAX_ROWS ? `   (first ${MAX_ROWS} of ${r.items.length})` : "");
  $status.textContent = "";
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

function enterFolder(item) {
  $q.value = item.path + "/";
  render();
  $q.focus();
  $q.setSelectionRange($q.value.length, $q.value.length);
}

async function activate(item, how) {
  if (!item) return;
  if (item.type === "folder") return enterFolder(item);
  try {
    if (how === "tab") await browser.tabs.create({ url: item.url });
    else if (how === "bg") await browser.tabs.create({ url: item.url, active: false });
    else await browser.tabs.update({ url: item.url });
    if (how !== "bg") window.close();   // background tabs keep the popup open for opening several
  } catch (err) {
    $status.textContent = "Firefox doesn't allow extensions to open this kind of URL.";
  }
}

const atEnd = () => $q.selectionStart === $q.value.length && $q.selectionEnd === $q.value.length;

$q.addEventListener("input", render);

document.addEventListener("keydown", e => {
  const n = items.length;
  switch (e.key) {
    case "ArrowDown": if (n) { sel = (sel + 1) % n; paint(); } e.preventDefault(); break;
    case "ArrowUp":   if (n) { sel = (sel - 1 + n) % n; paint(); } e.preventDefault(); break;
    case "Enter":
      activate(items[sel], e.ctrlKey || e.metaKey ? "tab" : e.shiftKey ? "bg" : "cur");
      e.preventDefault();
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
    case "Escape": window.close(); break;
  }
});

// Firefox popups don't always hand focus to the input right away, so ask several times.
const focusInput = () => { $q.focus(); $q.select(); };
load().then(() => { render(); focusInput(); });
focusInput();
document.addEventListener("DOMContentLoaded", focusInput);
window.addEventListener("load", focusInput);
setTimeout(focusInput, 30);
setTimeout(focusInput, 120);
