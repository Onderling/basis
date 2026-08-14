/**
 * The push knob has TWO boot doors — the CLI (`bin/relay.js`) and the PaaS entrypoint
 * (`deploy/relay/entrypoint.mjs`) — and one operator memory. This pins the AGREEMENT: both
 * doors read the SAME env names (PUSH_PROVIDER / EXPO_ACCESS_TOKEN / PUSH_TOKENS_DB), so a
 * runbook written for one deployment works on the other. The CLI briefly shipped its own
 * name for the same knob (PUSH_WAKE, 2026-08-14) before this pin existed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cli = readFileSync(join(here, '../bin/relay.js'), 'utf8');
const paas = readFileSync(join(here, '../../../deploy/relay/entrypoint.mjs'), 'utf8');

describe('push env agreement — one knob, one name, both boot doors', () => {
  it.each(['PUSH_PROVIDER', 'EXPO_ACCESS_TOKEN', 'PUSH_TOKENS_DB'])('%s is read by both doors', (name) => {
    expect(cli).toContain(`process.env.${name}`);
    expect(paas).toContain(`process.env.${name}`);
  });
  it('no door grows a private alias for the provider knob', () => {
    for (const src of [cli, paas]) expect(src).not.toMatch(/PUSH_WAKE/);
  });
});
