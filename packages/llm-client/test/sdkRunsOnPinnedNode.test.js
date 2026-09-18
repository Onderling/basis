/**
 * THE CONFIDENTIAL ROUTE'S SDK MUST RUN ON THE NODE THIS REPO PINS.
 *
 * `openai` and `privatemode-ai` are OPTIONAL dependencies of this package: a device without a key never
 * loads them. pnpm treats an optional dependency whose `engines.node` the running node does not satisfy
 * as "skip, silently" — no warning, no error, just absent. Measured on the first personal box
 * (2026-09-18): the lock had resolved `openai@7.10.0` (`node >=22`), the assistant image runs the node
 * `.nvmrc` pins (20), so the image had `privatemode-ai` and no `openai`, and the moment a key was put in
 * the device crash-looped on `Cannot find package 'openai'`. Locally an older `openai` 6 happened to be
 * hoisted, which is why nothing here ever noticed.
 *
 * So this reads the lock the image installs from and checks every resolved package's engine range
 * against the pinned node. Red the day a lock refresh drifts to a line the image cannot run.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
import semver from 'semver';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCK = path.join(HERE, '..', 'pnpm-lock.yaml');
const NVMRC = path.join(HERE, '..', '..', '..', '.nvmrc');

describe('the SDKs this package resolves run on the pinned node', () => {
  const pinned = readFileSync(NVMRC, 'utf8').trim();
  const lock = yaml.load(readFileSync(LOCK, 'utf8'));
  const packages = lock?.packages ?? {};

  it('pins a real node version', () => {
    expect(semver.valid(pinned), `.nvmrc holds ${JSON.stringify(pinned)}`).toBeTruthy();
  });

  it('every resolved package with an engine range accepts it — the optional SDKs included', () => {
    const offenders = [];
    for (const [id, meta] of Object.entries(packages)) {
      const range = meta?.engines?.node;
      if (!range) continue;
      if (!semver.satisfies(pinned, range, { includePrerelease: true })) offenders.push(`${id} wants node ${range}`);
    }
    expect(offenders, `resolved in pnpm-lock.yaml but unrunnable on node ${pinned} — pnpm would install these silently or, when optional, skip them silently:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('the confidential route\'s two SDKs are in the lock at all', () => {
    const ids = Object.keys(packages);
    expect(ids.some((k) => k.startsWith('openai@')), 'openai is resolved').toBe(true);
    expect(ids.some((k) => k.startsWith('privatemode-ai@')), 'privatemode-ai is resolved').toBe(true);
  });
});
