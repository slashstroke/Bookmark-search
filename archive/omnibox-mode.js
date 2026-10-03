// ARCHIVED: address-bar mode ("b <words>" / "b folder/sub/") -- removed from the 1.0 package.
//
// To bring it back:
//   1. manifest.json:  add   "omnibox": { "keyword": "b" }
//                      and set  "background": { "scripts": ["search.js", "background.js"] }
//   2. Paste the code below into background.js (it uses buildIndex, compute, loadUsage, recordUse and
//      bookmarkPool from search.js, so search.js must be loaded first).
//   3. Re-add `const DAY` handling: search.js already defines DAY, so delete the `const DAY = 86400000;`
//      line from background.js to avoid a duplicate declaration.
//   Known rough edges that made it feel unfinished: Enter on a folder row can't open the folder
//   (the omnibox API can't rewrite the address bar text); every row shows the same puzzle-piece icon;
//   Firefox shows only a handful of suggestions.

// ---------------------------------------------------------------------------
// Address bar: type "b <words>" or "b folder/sub/" (same ranking as the popup)
// ---------------------------------------------------------------------------
const OMNIBOX_MAX = 8;
let indexPromise = null;

function ensureIndex() {
  if (!indexPromise) indexPromise = browser.bookmarks.getTree().then(([tree]) => buildIndex(tree));
  return indexPromise;
}
for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved"]) {
  browser.bookmarks[ev].addListener(() => { indexPromise = null; });
}

browser.omnibox.setDefaultSuggestion({
  description: "Bookmark Search: type words, or a folder path like tools/dev/"
});

browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
  if (!text.trim()) return;
  await ensureIndex();
  await loadUsage();
  const r = compute(text);
  suggest(r.items.slice(0, OMNIBOX_MAX).map(it => {
    if (it.type === "folder") {
      return { content: it.path + "/", description: `📁 ${it.path}/  (${it.count} items)` };
    }
    const parent = it.where ? it.where.split("/").pop() + "/" : "";
    return { content: it.url, description: `${parent}${it.title} - ${it.url}` };
  }));
});

browser.omnibox.onInputEntered.addListener(async (text, disposition) => {
  // Folder suggestions end in "/" and aren't URLs, so Enter on them does nothing.
  if (!/^(https?|ftp|file|about):/i.test(text)) return;
  try {
    await ensureIndex();
    if (bookmarkPool.some(b => b.url === text)) recordUse({ type: "bookmark", url: text });
  } catch {}
  switch (disposition) {
    case "newForegroundTab": browser.tabs.create({ url: text }); break;
    case "newBackgroundTab": browser.tabs.create({ url: text, active: false }); break;
    default: browser.tabs.update({ url: text });
  }
});
