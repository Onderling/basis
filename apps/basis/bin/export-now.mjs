#!/usr/bin/env node
/**
 * export-now — the box's updater asks the RUNNING assistant for a fresh export of the household before it changes
 * anything. Run inside the assistant's container:
 *
 *   docker compose exec -T assistant node apps/basis/bin/export-now.mjs --sha <outgoing version> [--data-dir /data/assistant]
 *
 * It drops a request in the exports dir and waits for the runner's answer (its tick answers within a minute). It opens
 * no store itself: the runner is the one process that holds the household. Prints the file's name; exits 1 when the
 * export failed or no answer came — the updater then holds the update.
 */
import { parseArgs } from 'node:util';
import path from 'node:path';
import { exportDirFiles } from '../src/v2/exportDirFiles.js';
import { requestExportNow } from '../src/v2/exportRequest.js';

const { values } = parseArgs({ options: {
  'data-dir': { type: 'string', default: '/data/assistant' },
  sha: { type: 'string', default: 'unknown' },
  timeout: { type: 'string', default: '150' },
} });
const files = exportDirFiles(path.join(path.resolve(values['data-dir']), 'exports'));
const res = await requestExportNow({ files, sha: values.sha, timeoutMs: Math.max(5, Number(values.timeout) || 150) * 1000 });
if (res.ok) { console.log(res.name); process.exit(0); }
console.error(`export-now: no export (${res.error})`);
process.exit(1);
