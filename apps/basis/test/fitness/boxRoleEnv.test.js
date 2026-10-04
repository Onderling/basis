/**
 * THE BOX'S ENVIRONMENT, BOTH WAYS.
 *
 * The assistant container gets its settings from the box's `.env` through `deploy/roles/assistant.yml`, which names
 * every variable it passes. A variable the runner reads but the role does not pass is silently unset in production
 * (`TG_ADMIN_UID`, 2026-09-29: the admin setting worked in every test and never reached a box); a variable the role
 * passes but nothing reads is a setting that does nothing (`ASSISTANT_LANG`, the same day). Both fail here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const runner = readFileSync(path.join(REPO, 'apps/basis/bin/device-runner.mjs'), 'utf8');
const role = readFileSync(path.join(REPO, 'deploy/roles/assistant.yml'), 'utf8');

// Read by the runner, not passed by the role — on purpose.
const NOT_PASSED = {
  BASIS_VAULT_PASSPHRASE: 'generated once beside the vault on the data volume; never in the .env',
  PRIVATEMODE_MODEL: 'optional override of the default model; the default is what a box runs',
};
// Passed by the role, read elsewhere than the runner.
const READ_ELSEWHERE = {
  PRIVATEMODE_API_KEY: 'packages/llm-client/src/providers/privatemode.js',
};

const readByRunner = new Set([...runner.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]));
const environment = role.slice(role.indexOf('environment:'), role.indexOf('volumes:'));
const passed = new Set([...environment.matchAll(/^\s+([A-Z_]+):/gm)].map((m) => m[1]));

describe('the assistant container\'s environment', () => {
  it('every variable the runner reads is passed by the role, or listed with the reason it is not', () => {
    const missing = [...readByRunner].filter((v) => !passed.has(v) && !NOT_PASSED[v]);
    expect(missing).toEqual([]);
  });

  it('every variable the role passes is read — by the runner, or where the list says', () => {
    const unread = [...passed].filter((v) => !readByRunner.has(v) && !READ_ELSEWHERE[v]);
    expect(unread).toEqual([]);
    for (const [v, file] of Object.entries(READ_ELSEWHERE)) {
      expect(readFileSync(path.join(REPO, file), 'utf8'), `${v} is read in ${file}`).toContain(v);
    }
  });
});
