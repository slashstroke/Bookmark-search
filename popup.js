// Popup UI for Bookmark Search. The search/navigation logic lives in search.js. Ctrl+Shift+Enter opens
// every bookmark in the highlighted folder; Ctrl+D saves the current page into the folder you're viewing
// (or the highlighted folder row).

const MAX_ROWS = 100;
const OPEN_ALL_CONFIRM_ABOVE = 10;

const $q = document.getElementById("q");
const $crumb = document.getElementById("crumb");
const $list = document.getElementById("list");
const $status = document.getElementById("status");

let items = [], sel = 0, view = {}, pendingOpenAll = null;

async function load() {
  const [tree] = await browser.bookmarks.getTree();
  buildIndex(tree);
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
