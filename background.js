// Background script: first-run page and the optional website-icon cache for the popup.

const DAY = 86400000;

// ---------------------------------------------------------------------------
// First run: open the options page once so people can find the optional icon setting
// ---------------------------------------------------------------------------
browser.runtime.onInstalled.addListener(async details => {
  if (details.reason !== "install") return;
  try {
    const { welcomed } = await browser.storage.local.get("welcomed");
    if (welcomed) return;
    await browser.storage.local.set({ welcomed: true });
    await browser.tabs.create({ url: browser.runtime.getURL("options.html?welcome=1") });
  } catch {}
});

// ---------------------------------------------------------------------------
// Favicon cache (used by the popup)
// OFF by default. When the user turns it on in the options page, the hostname of each public
// bookmarked site is sent once to DuckDuckGo's icon service; the icon is then stored locally.
// ---------------------------------------------------------------------------
const ICON_HOST_PATTERN = "https://icons.duckduckgo.com/*";
const ICON_URL = host => `https://icons.duckduckgo.com/ip3/${host}.ico`;
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
