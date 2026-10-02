// Bookmark Folder Search  (v0.2)
//
//   b test            -> contents of the folder best matching "test" (subfolders first)
//   b test git        -> bookmarks anywhere under "test" whose title/url contain "git"
//   b test/           -> same as "b test", written as a path
//   b test/subfolder 1/   -> enter a subfolder (spaces are fine once a "/" is used)
//   b test/sub        -> text after the last "/" filters that folder's contents

const MAX_RESULTS = 10;
let folderCache = null;

const isFolder = n => n.type === "folder";

async function buildIndex() {
  const [root] = await browser.bookmarks.getTree();
  const folders = [];
  (function walk(node, path) {
    if (!isFolder(node)) return;
    const isRoot = node.id === root.id;
    const here = isRoot ? [] : [...path, node.title];
    if (!isRoot) folders.push({ path: here.join("/"), name: node.title, node });
    for (const child of node.children || []) walk(child, here);
  })(root, []);
  return folders;
}

async function getFolders() {
  if (!folderCache) folderCache = await buildIndex();
  return folderCache;
}

for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved"]) {
  browser.bookmarks[ev].addListener(() => { folderCache = null; });
}

function collectBookmarks(node, prefix = "") {
  const out = [];
  for (const c of node.children || []) {
    if (c.url) out.push({ title: c.title || c.url, url: c.url, rel: prefix });
    else if (isFolder(c)) out.push(...collectBookmarks(c, `${prefix}${c.title}/`));
  }
  return out;
}

// First path segment: match a folder anywhere in the tree.
function pickFolder(folders, query) {
  const q = query.toLowerCase();
  const matches = folders.filter(f => f.path.toLowerCase().includes(q));
  const score = f => {
    if (f.name.toLowerCase() === q) return 0;
    if (f.path.toLowerCase().endsWith(q)) return 1;
    return 2;
  };
  matches.sort((a, b) => score(a) - score(b) || a.path.length - b.path.length);
  return matches[0] || null;
}

// Later segments: match among the current folder's child folders.
function childMatch(parent, seg) {
  const q = seg.toLowerCase();
  const kids = (parent.children || []).filter(isFolder);
  return kids.find(c => c.title.toLowerCase() === q)
      || kids.find(c => c.title.toLowerCase().startsWith(q))
      || kids.find(c => c.title.toLowerCase().includes(q))
      || null;
}

async function resolveInput(rawText) {
  const text = rawText.replace(/^\/+/, "");
  if (!text.trim()) return null;

  let segments, filter;
  if (text.includes("/")) {
    segments = text.split("/");
    filter = segments.pop().trim();
  } else {
    const [first, ...rest] = text.trim().split(/\s+/);
    segments = [first];
    filter = rest.join(" ");
  }
  segments = segments.map(s => s.trim()).filter(Boolean);
  if (!segments.length) return null;

  const folders = await getFolders();
  const first = pickFolder(folders, segments[0]);
  if (!first) return { missing: segments[0], folders };

  let node = first.node;
  const chain = [first.name];
  for (const seg of segments.slice(1)) {
    const next = childMatch(node, seg);
    if (!next) return { missing: seg, node, chain };
    node = next;
    chain.push(next.title);
  }
  return { node, chain, filter };
}

const folderSuggestion = (prefix, c) => ({
  content: `${prefix}${c.title}/`,
  description: `📁 ${prefix}${c.title}/  (${(c.children || []).length} items)`
});

browser.omnibox.setDefaultSuggestion({
  description: "Folder name, then / to go deeper (e.g. tools/sub/). Text after the last / filters."
});

browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const res = await resolveInput(text);
  if (!res) return;

  if (res.missing) {
    const q = res.missing.toLowerCase();
    if (res.node) {
      const prefix = res.chain.join("/") + "/";
      suggest(
        (res.node.children || []).filter(isFolder)
          .slice(0, MAX_RESULTS).map(c => folderSuggestion(prefix, c))
      );
    } else {
      suggest(
        res.folders.filter(f => f.path.toLowerCase().includes(q))
          .slice(0, MAX_RESULTS)
          .map(f => ({ content: f.path + "/", description: `📁 ${f.path}/` }))
      );
    }
    return;
  }

  const { node, chain } = res;
  const f = res.filter.toLowerCase();
  const prefix = chain.join("/") + "/";
  const matches = b => b.title.toLowerCase().includes(f) || b.url.toLowerCase().includes(f);

  const subfolders = (node.children || [])
    .filter(c => isFolder(c) && (!f || c.title.toLowerCase().includes(f)))
    .map(c => folderSuggestion(prefix, c));

  // No filter: direct children only. With a filter: search the whole subtree.
  const bookmarks = (f ? collectBookmarks(node).filter(matches)
                       : (node.children || []).filter(c => c.url)
                           .map(c => ({ title: c.title || c.url, url: c.url, rel: "" })))
    .map(b => ({ content: b.url, description: `${prefix}${b.rel}${b.title} - ${b.url}` }));

  suggest([...subfolders, ...bookmarks].slice(0, MAX_RESULTS));
});

browser.omnibox.onInputEntered.addListener((text, disposition) => {
  // Folder suggestions end in "/" and aren't URLs, so Enter on them does nothing.
  if (!/^(https?|ftp|file|about):/i.test(text)) return;
  switch (disposition) {
    case "newForegroundTab": browser.tabs.create({ url: text }); break;
    case "newBackgroundTab": browser.tabs.create({ url: text, active: false }); break;
    default: browser.tabs.update({ url: text });
  }
});

// ---------------------------------------------------------------------------
// Favicon cache (used by the popup)
// OFF by default. When the user turns it on in the options page, the hostname of each public
// bookmarked site is sent once to DuckDuckGo's icon service; the icon is then stored locally.
// ---------------------------------------------------------------------------
const ICON_HOST_PATTERN = "https://icons.duckduckgo.com/*";
const ICON_URL = host => `https://icons.duckduckgo.com/ip3/${host}.ico`;
const DAY = 86400000;
const MAX_CONCURRENT_FETCHES = 6;
const MAX_ICON_BYTES = 20000;
const MAX_CACHE_CHARS = 3000000;      // keeps the stored icons to a few MB

const iconCache = new Map();          // host -> { d: dataURL | null, t: timestamp }
const iconsReady = browser.storage.local.get(null).then(all => {
  for (const [k, v] of Object.entries(all)) if (k.startsWith("icon:")) iconCache.set(k.slice(5), v);
}).catch(() => {});

// Icons are only fetched while the user has granted BOTH the host permission and the
// "bookmarksInfo" data-collection opt-in (either can be withdrawn in about:addons).
let allowedPromise = null;
function iconsAllowed() {
  if (!allowedPromise) {
    allowedPromise = browser.permissions.getAll().then(p =>
      (p.origins || []).includes(ICON_HOST_PATTERN) &&
      (!p.data_collection || p.data_collection.includes("bookmarksInfo"))
    ).catch(() => false);
  }
  return allowedPromise;
}
browser.permissions.onAdded.addListener(() => { allowedPromise = null; });
browser.permissions.onRemoved.addListener(() => { allowedPromise = null; });

// Never send intranet-style names or IP addresses to a third-party service.
const isPublicHost = h =>
  /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(h) &&
  !/^\d+(\.\d+){3}$/.test(h) &&
  !/\.(local|localhost|internal|lan|home|test|invalid)$/i.test(h);

let activeFetches = 0;
const fetchQueue = [];
function limited(fn) {
  return new Promise((resolve, reject) => { fetchQueue.push({ fn, resolve, reject }); pump(); });
}
function pump() {
  while (activeFetches < MAX_CONCURRENT_FETCHES && fetchQueue.length) {
    const { fn, resolve, reject } = fetchQueue.shift();
    activeFetches++;
    fn().then(resolve, reject).finally(() => { activeFetches--; pump(); });
  }
}

async function fetchIcon(host) {
  try {
    const res = await fetch(ICON_URL(host), { credentials: "omit" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size || blob.size > MAX_ICON_BYTES || blob.type.startsWith("text/")) return null;
    return await new Promise((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = no;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Drop the oldest icons when the stored total grows past the cap.
function trimCache() {
  let total = 0;
  for (const e of iconCache.values()) total += e.d ? e.d.length : 0;
  if (total <= MAX_CACHE_CHARS) return;
  const drop = [];
  for (const [host, e] of [...iconCache.entries()].sort((a, b) => a[1].t - b[1].t)) {
    if (total <= MAX_CACHE_CHARS * 0.8) break;
    total -= e.d ? e.d.length : 0;
    iconCache.delete(host);
    drop.push("icon:" + host);
  }
  if (drop.length) browser.storage.local.remove(drop).catch(() => {});
}

const inflight = new Map();
function refetch(host) {
  if (!inflight.has(host)) {
    inflight.set(host, limited(() => fetchIcon(host)).then(d => {
      const old = iconCache.get(host);
      const entry = { d: d || (old && old.d) || null, t: Date.now() };
      iconCache.set(host, entry);
      browser.storage.local.set({ ["icon:" + host]: entry }).catch(() => {});
      trimCache();
      return entry.d;
    }).finally(() => inflight.delete(host)));
  }
  return inflight.get(host);
}

async function getIcon(host) {
  await iconsReady;
  const e = iconCache.get(host);
  // Found icons are refreshed monthly, misses retried weekly. Stale icons are still served instantly.
  if (e && Date.now() - e.t < (e.d ? 30 * DAY : 7 * DAY)) return e.d;
  const pending = refetch(host);
  return e && e.d ? e.d : pending;
}

browser.runtime.onMessage.addListener(msg => {
  if (!msg) return;
  if (msg.type === "icon" && typeof msg.host === "string") {
    if (!isPublicHost(msg.host)) return Promise.resolve(null);
    return iconsAllowed().then(ok => (ok ? getIcon(msg.host) : null));
  }
  if (msg.type === "clearIcons") {
    return iconsReady.then(async () => {
      const all = await browser.storage.local.get(null);
      const keys = Object.keys(all).filter(k => k.startsWith("icon:"));
      iconCache.clear();
      if (keys.length) await browser.storage.local.remove(keys);
      return true;
    });
  }
});
