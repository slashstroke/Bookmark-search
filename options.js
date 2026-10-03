const ICON_HOST = "https://icons.duckduckgo.com/*";
const WANT = { origins: [ICON_HOST], data_collection: ["bookmarksInfo"] };

const $icons = document.getElementById("icons");
const $clear = document.getElementById("clear");
const $msg = document.getElementById("msg");

async function granted() {
  try {
    const p = await browser.permissions.getAll();
    return (p.origins || []).includes(ICON_HOST) &&
           (!p.data_collection || p.data_collection.includes("bookmarksInfo"));
  } catch { return false; }
}

async function refresh() { $icons.checked = await granted(); }

$icons.addEventListener("change", async () => {
  $msg.textContent = "";
  try {
    if ($icons.checked) {
      // permissions.request must be called straight from the click handler.
      const ok = await browser.permissions.request(WANT);
      $icons.checked = ok;
      if (!ok) $msg.textContent = "Icons stay off because permission wasn't granted.";
    } else {
      await browser.permissions.remove(WANT);
    }
  } catch (err) {
    await refresh();
    $msg.textContent = "Couldn't change this setting: " + (err && err.message ? err.message : err);
  }
});

$clear.addEventListener("click", async () => {
  try {
    await browser.runtime.sendMessage({ type: "clearIcons" });
    $msg.textContent = "Saved icons cleared.";
  } catch (err) {
    $msg.textContent = "Couldn't clear icons: " + (err && err.message ? err.message : err);
  }
});

browser.permissions.onAdded.addListener(refresh);
browser.permissions.onRemoved.addListener(refresh);
refresh();

if (new URLSearchParams(location.search).has("welcome")) {
  document.getElementById("welcome").classList.add("show");
}
