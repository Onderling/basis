#!/usr/bin/env node
/**
 * lint-carrying — the carrying index held to the code (`carrying.mjs`): every server route and store is declared with
 * its row; every row's "used today by" file exists and reaches the mechanism. Inert rows are counted, not refused.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCarrying, carryingMessages } from './carrying.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n')
  .filter((f) => /\.m?js$/.test(f) && !/(^|\/)(test|tests|test-browser|e2e|e2e-journeys|fixtures|node_modules|_archive)\//.test(f) && !/\.test\.m?js$/.test(f));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const r = checkCarrying({ read, files });

const red = r.unlisted.length + r.unknownRow.length + r.unreached.length;
for (const l of carryingMessages(r, { read })) console.error(l);
if (!red) console.log(`✓ lint-carrying: ${r.rows} rows, every server route and store declared, every consumer reaches its row · ${r.inert} inert (kept; see the index)`);
process.exit(red ? 1 : 0);
