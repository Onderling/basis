#!/usr/bin/env node
/**
 * lint-asked-frits — the open-questions table matches the `? Needs Frits` markers it projects.
 *
 * A guard outside the aggregate does not exist (CLAUDE.md), and a generated block nobody checks is a
 * maintained list with extra steps — which is precisely what this replaced. Red when stale; the fix is
 * `node scripts/asked-frits.mjs`.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [path.join(HERE, 'asked-frits.mjs'), '--check'], { encoding: 'utf8' });
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
process.exit(r.status ?? 0);
