// Settings for `npx web-ext lint` / `npx web-ext build`: keep documentation and unshipped code out of the package.
module.exports = {
  ignoreFiles: ["web-ext-config.cjs", "archive", "README.md", "PRIVACY.md", "LICENSE", "package.json", "package-lock.json"],
  build: { overwriteDest: true },
};
