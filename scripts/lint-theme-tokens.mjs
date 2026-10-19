#!/usr/bin/env node
/**
 * lint-theme-tokens — the web design system's drift guards, in the aggregate (`npm run guards`).
 *
 * `apps/basis/scripts/theme-fitness.mjs` holds them: theme.css regenerates clean from the shared tokens; every
 * `var(--x)` circle.css uses is DEFINED (an undefined one falls back to a hardcoded light colour — the grey text in
 * dark mode was five of those); no live hex in circle.css or the web JS. It ran only under `npm run fitness`, outside
 * the aggregate, and sat red unseen (found 2026-10-19 with the dark-mode fix). A guard outside the aggregate does not
 * exist — so the aggregate runs it.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const r = spawnSync(process.execPath, [path.join(ROOT, 'apps/basis/scripts/theme-fitness.mjs')], { cwd: path.join(ROOT, 'apps/basis'), encoding: 'utf8' });
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
process.exit(r.status ?? 1);
