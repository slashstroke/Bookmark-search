# Privacy Policy

_Last updated: 2 October 2026_

Bookmark Search works on your device. It has no server, no accounts and no analytics, and the developer
receives no data from it.

## What stays on your device

- **Your bookmarks.** The extension reads your bookmarks to show and search them. They are never sent anywhere.
  When you press Ctrl+D it adds the current page to the folder you chose, and nothing else is changed.
- **Usage counts.** To rank items you open often, it stores how many times and when you opened each bookmark or
  folder, in the extension's local storage.
- **Current tab.** When you press Ctrl+D, it reads the address and title of the tab you are on, to create the
  bookmark.
- **Saved icons.** If you turn on website icons (below), downloaded icons are saved in local storage.

Uninstalling the extension deletes all of this.

## Website icons (optional, off by default)

Website icons are only shown if you turn on **Show website icons** in the extension's options and approve
Firefox's permission prompt. When this is on:

- The **hostname** of each bookmarked site (for example `github.com`) is sent to DuckDuckGo's icon service
  (`icons.duckduckgo.com`) to download the site's icon. Each site is requested once; found icons are refreshed
  about monthly and missing ones retried about weekly.
- Only the hostname is sent, never full addresses, page titles, bookmark names or folder names. Local and
  private addresses (such as `localhost`, IP addresses and `.local` names) are never sent.
- As with any web request, DuckDuckGo can see your IP address. How DuckDuckGo handles requests is described in
  its own privacy policy: https://duckduckgo.com/privacy
- The developer does not receive or see this data.

You can turn this off at any time by unticking the option, by withdrawing the permission in `about:addons`
(Permissions and data), or by pressing **Clear saved icons** to delete downloaded icons. With icons off, no
network requests are made at all.

## What is not done

No data is sold or shared with advertisers or data brokers. There is no tracking, no telemetry, no
remote code, and no data is used for anything other than the features described above.

## Contact

Questions or concerns: please open an issue at
https://github.com/slashstroke/Bookmark-search/issues
