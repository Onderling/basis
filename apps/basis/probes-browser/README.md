# Browser probes

Walks that **report** what they find — a `PASS` / `FINDING` / `BLOCKED` line per step — and **assert nothing**. A walk
like that passes whatever happens, so it is not a test: it lived in `test-browser/` and counted as green in the release
tail while it logged findings (walk-pod passed for months while logging that no circle could be pointed at a pod).

They are kept because they are useful to *walk*: run one by hand and read its lines.

    PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=probes probes-browser/walk-pod.spec.js

To make one a test again: turn the FINDING lines it must not produce into `expect`s and move it back to `test-browser/`
(the `lint-browser-specs-assert` guard refuses a spec there that asserts nothing).
