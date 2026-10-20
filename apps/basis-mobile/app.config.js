/**
 * The dynamic Expo config over app.json: the one thing it adds is the version the build was made from
 * (`extra.appVersion`, from the tree's exact clean tag; see appVersion.cjs). Everything else is app.json's.
 */
const { resolveAppVersion } = require('./appVersion.cjs');

module.exports = ({ config }) => ({
  ...config,
  extra: { ...(config.extra ?? {}), appVersion: resolveAppVersion() },
});
