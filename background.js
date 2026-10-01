// Bookmark Folder Search
// Usage in the address bar:
//   b tools          -> all bookmarks inside any folder matching "tools" (recursive)
//   b tools git      -> only those whose title/url contains "git"
//   b toolbar/tools  -> folder path match, e.g. "Bookmarks Toolbar/tools"

const MAX_RESULTS = 10;
let folderCache = null;

async function buildIndex() {
  const [root] = await browser.bookmarks.getTree();
  const folders = [];
  (function walk(node, path) {
    if (node.url) return;
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

// Invalidate the cache whenever bookmarks change.
for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved"]) {
  browser.bookmarks[ev].addListener(() => { folderCache = null; });
}

function collectBookmarks(folderNode, prefix = "") {
  const out = [];
  for (const child of folderNode.children || []) {
    if (child.url) {
      out.push({ title: child.title || child.url, url: child.url, rel: prefix });
    } else {
      out.push(...collectBookmarks(child, `${prefix}${child.title}/`));
    }
  }
  return out;
}

function pickFolder(folders, query) {
  const q = query.replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!q) return null;
  const matches = folders.filter(f => f.path.toLowerCase().includes(q));
  // Rank: exact name > path ends with query > anything else (shorter path first)
  const score = f => {
    const p = f.path.toLowerCase();
    if (f.name.toLowerCase() === q) return 0;
    if (p.endsWith(q)) return 1;
    return 2;
  };
  matches.sort((a, b) => score(a) - score(b) || a.path.length - b.path.length);
  return matches[0] || null;
}

browser.omnibox.setDefaultSuggestion({
  description: "Type a folder name, then optional filter text (e.g. tools git)"
});

browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const [folderQuery, ...rest] = text.trim().split(/\s+/);
  const filter = rest.join(" ").toLowerCase();
  if (!folderQuery) return;

  const folders = await getFolders();
  const folder = pickFolder(folders, folderQuery);

  if (!folder) {
    // No folder match: suggest folders that are close, so the user can see names.
    const q = folderQuery.toLowerCase();
    suggest(
      folders
        .filter(f => f.path.toLowerCase().includes(q))
        .slice(0, MAX_RESULTS)
        .map(f => ({ content: f.path, description: `Folder: ${f.path}` }))
    );
    return;
  }

  const items = collectBookmarks(folder.node).filter(b =>
    !filter ||
    b.title.toLowerCase().includes(filter) ||
    b.url.toLowerCase().includes(filter)
  );

  suggest(
    items.slice(0, MAX_RESULTS).map(b => ({
      content: b.url,
      description: `${folder.name}/${b.rel}${b.title} - ${b.url}`
    }))
  );
});

browser.omnibox.onInputEntered.addListener((text, disposition) => {
  // Only act on real URLs (our suggestions use the URL as content).
  if (!/^(https?|ftp|file|about):/i.test(text)) return;
  switch (disposition) {
    case "newForegroundTab":
      browser.tabs.create({ url: text });
      break;
    case "newBackgroundTab":
      browser.tabs.create({ url: text, active: false });
      break;
    default:
      browser.tabs.update({ url: text });
  }
});
