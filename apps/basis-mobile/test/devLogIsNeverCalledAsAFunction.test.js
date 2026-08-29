/**
 * GUARD — `dlog` is a channel OBJECT; calling it is a TypeError, and one of them was in the boot path.
 *
 * `devLog.js` exports `dlog = { boot, dispatch, render, button, warn }`. Every call site uses a channel
 * (`dlog.boot(…)`) except two in App.js, which called `dlog(…)` directly — inside the device-log
 * persistence wiring, and inside the catch that was supposed to contain it.
 *
 * The result (found on a real device, 2026-08-29): the app boots fine while its device log is empty, and
 * fails to boot AT ALL from the first launch that has persisted entries to hydrate — `if (hydrated)
 * dlog(…)` throws, the catch throws the same way, and the whole agent bundle reports
 * `boot failed (App): dlog is not a function (it is Object)`. The screen then shows "No circles yet",
 * which reads as data loss rather than as a boot failure. The more the app is used, the more certain it
 * is to break on next launch.
 *
 * Nothing else catches this: `dlog` IS bound, so the undefined-identifier guard is satisfied, and the
 * two lines only execute on a device with history. Hence a grep.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function jsFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'android' || e.name === 'ios') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsFiles(p, out);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js') && statSync(p).size < 2_000_000) out.push(p);
  }
  return out;
}

describe('GUARD — dlog is used as a channel, never called', () => {
  it('no file calls dlog(...) directly', () => {
    const offenders = [];
    for (const file of jsFiles(ROOT)) {
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        // `dlog(` — but not `dlog.boot(`, and not the export/definition itself.
        if (/(^|[^.\w])dlog\s*\(/.test(line) && !/export\s+(const|function)\s+dlog/.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
    expect(offenders, 'dlog is an object of channels — calling it throws, and in a boot path it costs the whole boot').toEqual([]);
  });
});
