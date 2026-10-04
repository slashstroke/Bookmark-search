// Settings for `npx web-ext lint` / `npx web-ext build`: keep documentation, notes, store images and
// unshipped code out of the package that gets uploaded to Firefox Add-ons.
// This file is not part of the extension. The extension uses icon.svg only, so no PNG is shipped;
// if you ever switch the manifest to PNG icons, remove the "**/*.png" line.
module.exports = {
  ignoreFiles: [
    "web-ext-config.cjs",
    "archive",
    "docs",
    "store",
    "amo-listing.md",
    "README.md",
    "PRIVACY.md",
    "LICENSE",
    "package.json",
    "package-lock.json",
    "**/*.png",
  ],
  build: { overwriteDest: true },
};
