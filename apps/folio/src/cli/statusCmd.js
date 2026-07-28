/**
 * folio status — show pending changes WITHOUT modifying state.
 *
 * Folio.A1 didn't ship a SyncEngine.status() helper, so this command
 * imports scanLocal / scanPod / diff directly and runs them in dry-run
 * mode against the persisted state file.
 *
 * Output:
 *   localRoot, podRoot, last sync time, pending uploads/downloads/conflicts.
 */
import { promises as fs } from 'node:fs';
import { join }           from 'node:path';

import { PathMap }   from '../PathMap.js';
import { scanLocal } from '../scanLocal.js';
import { scanPod }   from '../scanPod.js';
import { diff }      from '../diff.js';
import { hasConflictMarkers } from '../applyConflict.js';

import { requireConfig }   from './_config.js';
import { buildPodClient }  from './_podFactory.js';

const STATE_FILE_RELPATH = '.onderling/notes-sync-state.json';
/** Read the sync-state file (null when absent). */
async function readStateText(fsImpl, root) {
  try { return await fsImpl.readFile(join(root, STATE_FILE_RELPATH), 'utf8'); }
  catch (err) { if (err.code !== 'ENOENT') throw err; return null; }
}


export async function statusCmd(_args) {
  const cfg       = await requireConfig();
  const podClient = await buildPodClient(cfg);

  const pathMap = new PathMap({ localRoot: cfg.localRoot, podRoot: cfg.podRoot });

  let knownState = {};
  let lastSyncAt = null;
  try {
    const text = await readStateText(fs, cfg.localRoot);
    if (text != null) {
      const parsed = JSON.parse(text);
      knownState = parsed.files ?? {};
      lastSyncAt = parsed.writtenAt ?? null;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const localScan = await scanLocal(cfg.localRoot, { pathMap });
  const podScan   = await scanPod(podClient, cfg.podRoot, { pathMap });
  const d         = diff(localScan, podScan, knownState);

  // Files containing unresolved conflict markers right now (independent of diff).
  let openConflictFiles = 0;
  for (const f of localScan) {
    try {
      const text = await fs.readFile(f.absPath, 'utf8');
      if (hasConflictMarkers(text)) openConflictFiles++;
    } catch { /* ignore */ }
  }

  console.log(`local:  ${cfg.localRoot}`);
  console.log(`pod:    ${cfg.podRoot}`);
  console.log(`webId:  ${cfg.webId ?? '(unset)'}`);
  console.log(`last sync: ${lastSyncAt ? new Date(lastSyncAt).toISOString() : 'never'}`);
  console.log('');
  console.log(`pending uploads:    ${d.toUpload.length}`);
  console.log(`pending downloads:  ${d.toDownload.length}`);
  console.log(`pending deletes:    ${d.toDelete.length}`);
  console.log(`pending conflicts:  ${d.conflicts.length}`);
  console.log(`open conflict files (already marked): ${openConflictFiles}`);

  if (d.toUpload.length || d.toDownload.length || d.conflicts.length) {
    console.log('');
    if (d.toUpload.length)   console.log('  upload:   ', d.toUpload.map((f) => f.relPath).join(', '));
    if (d.toDownload.length) console.log('  download: ', d.toDownload.map((f) => f.relPath).join(', '));
    if (d.conflicts.length)  console.log('  conflict: ', d.conflicts.map((f) => f.relPath).join(', '));
  }
}
