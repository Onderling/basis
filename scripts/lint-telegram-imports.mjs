#!/usr/bin/env node
/**
 * lint-telegram-imports — the Telegram folder is the BOX's Telegram door, nothing more.
 *
 * Code the assistant shares with every door (the person's own "+", a circle's bot, the box's Telegram chat) lives in
 * `apps/basis/src/assistant/`. The box composes its Telegram door from `apps/basis/bin/` and the folder's own files; the
 * shared code (`apps/basis/src` outside the folder, the web shell, the phone shell, scripts) never imports from it, or
 * shared behaviour would quietly depend on one door's folder again (the door catalogue lived there until 2026-11-16).
 *
 * Exit 1 with the importing lines. Tests are not scanned: they test the door.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const IMPORT = /(?:from\s+|import\s*\(\s*)['"]([^'"]*\/telegram\/[^'"]*)['"]/g;
const SHARED = /^apps\/basis\/(src|web|scripts)\/|^apps\/basis-mobile\/src\/|^scripts\//;

/** @param {string} file @param {string} text @returns {string[]} the offending lines */
export function telegramImportsIn(file, text) {
  if (!SHARED.test(file) || file.startsWith('apps/basis/src/telegram/')) return [];
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(IMPORT)) out.push(`${file}:${i + 1}: ${m[1]}`);
  });
  return out;
}

const run = () => {
  const files = execSync('git ls-files -- apps/basis/src apps/basis/web apps/basis-mobile/src apps/basis/scripts scripts', { encoding: 'utf8' })
    .split('\n').filter((f) => /\.(m?js|jsx)$/.test(f) && !f.startsWith('scripts/lint-telegram-imports'));
  const hits = files.flatMap((f) => { try { return telegramImportsIn(f, readFileSync(f, 'utf8')); } catch { return []; } });
  if (hits.length) {
    console.error(`\n✗ lint-telegram-imports — ${hits.length} import(s) of the box's Telegram folder from shared code:\n`);
    for (const h of hits) console.error(`  ${h}`);
    console.error('\nFix: move what is shared into apps/basis/src/assistant/ and import it from there.');
    process.exit(1);
  }
  console.log('✓ lint-telegram-imports: shared code imports nothing from the Telegram folder.');
};
if (import.meta.url === `file://${process.argv[1]}`) run();
