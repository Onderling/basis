import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    // Run test FILES one at a time (2026-08-02).
    //
    // Most of this suite boots a real relay over a real socket, and the boundary-authentication work took
    // it from 222 tests to 283 — several of them spinning up their own servers and agents. Past that point
    // the file-parallel default started tipping 5-second waits over the edge, and it did so in
    // `twoRelaysNoLinkage`: the J-R2/J-R4 PRIVACY journeys, which assert that a relay learns nothing about
    // a circle it does not host.
    //
    // It was never a real defect — the suite passes 283/283 single-threaded, repeatedly, and every failing
    // test passed in isolation. But a privacy test that fails one run in three is one people learn to
    // scroll past, and then it is worth nothing. Determinism beats the wall clock here; this suite takes
    // seconds either way.
    fileParallelism: false,
  },
});
