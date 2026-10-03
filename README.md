# Bookmark Search

Browse and search your bookmark folders from the keyboard, like a file explorer.

Press **Ctrl+Shift+F**, type a folder path such as `tools/dev/`, and see what is inside. No mouse, no digging
through the bookmarks menu.

> Firefox Add-ons listing: _link coming soon_

## Features

- **Folder paths.** `tools/` shows the folder, `tools/dev/` goes deeper. Words after the last `/` search inside
  that folder, including its subfolders.
- **Fuzzy search.** Type `ggl` to find Google. Folders and bookmarks are searched together.
- **Starts on your bookmarks toolbar,** in the same order as the bar itself.
- **Frequently opened items rise to the top** of search results.
- **Open all.** Open every bookmark in a folder as tabs, with confirmation above 10.
- **Save the current page** into any folder by path.
- **Optional website icons,** off by default (see Privacy).

## Keyboard

| Key | Action |
| --- | --- |
| Ctrl+Shift+F | Open the panel (changeable in `about:addons` > gear > Manage Extension Shortcuts) |
| Up / Down | Move selection |
| Enter | Open bookmark / enter folder |
| Tab or Right | Enter the highlighted folder |
| Left | Go up one level (when the box ends in `/`) |
| Ctrl+Enter | Open in a new tab |
| Shift+Enter | Open in a background tab (the panel stays open) |
| Ctrl+Shift+Enter | Open all bookmarks in the highlighted folder |
| Ctrl+D | Save the current page into the viewed or highlighted folder |
| Esc | Close |

## Privacy

Everything runs on your device and the developer receives no data. The only network request the extension can
make is the optional icon download: when you turn on **Show website icons**, the hostname of each bookmarked
site is sent once to DuckDuckGo's icon service. Details in [PRIVACY.md](PRIVACY.md).

## Permissions

| Permission | Why |
| --- | --- |
| `bookmarks` | Read your bookmarks; add one when you press Ctrl+D |
| `storage` | Remember how often you open items; store downloaded icons |
| `activeTab` | Read the current page's address and title when saving it |
| `https://icons.duckduckgo.com/*` (optional) | Download site icons, only if you turn them on |

## Development

Requires Firefox 140 or newer (desktop).

```
# run it
about:debugging#/runtime/this-firefox  ->  Load Temporary Add-on  ->  select manifest.json

# check and package (web-ext-config.cjs leaves out the docs and archive/)
npx web-ext lint
npx web-ext build
```

Files: `manifest.json`, `search.js` (search and ranking), `popup.html` / `popup.js` (the panel),
`background.js` (icon cache, first-run page), `options.html` / `options.js` (settings and how-to), `icon.svg`.
`archive/` holds code that is not shipped. `web-ext-config.cjs` controls what goes into the package.

Chrome and other Chromium browsers are not supported yet.

## License

[MIT](LICENSE)
