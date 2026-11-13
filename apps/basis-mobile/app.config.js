/**
 * The dynamic Expo config over app.json: the one thing it adds is the version the build was made from
 * (`extra.appVersion`, from the tree's exact clean tag; see appVersion.cjs). Everything else is app.json's.
 */
const { resolveAppVersion } = require('./appVersion.cjs');
const { assertSeededCardAllowed } = require('./e2eCardGuard.cjs');

module.exports = ({ config }) => {
  // the e2e maker's test card is refused in any build not marked e2e: a person's feedback never goes to a test identity
  assertSeededCardAllowed(process.env);
  return {
    ...config,
    extra: { ...(config.extra ?? {}), appVersion: resolveAppVersion() },
  };
};
