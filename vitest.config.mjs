// The ROOT vitest config exists for one reason: the guards' own self-tests (`scripts/*.test.mjs`).
//
// Several of them scan the whole repo (codenames, manifest completeness, health) and take seconds on a
// quiet machine — which is EXACTLY vitest's 5s default, so `npm run guards` went red whenever anything
// else ran beside it (a Metro bundle, three app suites back to back; 2026-08-29, three times in one day).
// A guard whose self-test fails on machine load is a false alarm, and a false alarm teaches people to
// ignore the aggregate. The bound below means "hung", not "busy". Apps keep their own configs.
// A plain object, not `defineConfig`: the root has no vitest install of its own to import from (the
// binary `npx vitest` finds lives in an app's node_modules), and vitest accepts the object as-is.
export default {
  test: {
    include: ['scripts/**/*.test.mjs'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
};
