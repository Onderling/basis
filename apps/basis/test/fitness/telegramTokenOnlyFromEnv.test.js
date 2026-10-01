/**
 * FITNESS: the box takes its Telegram token from TG_BOT_TOKEN only — never from a file in the home folder. A fallback
 * to `~/.canopy-tg-token` is how a developer's local run reached the LIVE bot's token (a 409 "only one bot instance",
 * 2026-09-30). An empty TG_BOT_TOKEN means no Telegram.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../bin/device-runner.mjs', import.meta.url), 'utf8');

describe('FITNESS: the Telegram token comes from the environment only', () => {
  it('no token file is read', () => {
    expect(src).not.toMatch(/tg-token/);
    expect(src).toMatch(/const tgToken = String\(process\.env\.TG_BOT_TOKEN \?\? ''\)\.trim\(\) \|\| null;/);
  });
});
