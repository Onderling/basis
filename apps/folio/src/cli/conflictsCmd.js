/**
 * folio conflicts — list files containing unresolved conflict markers.
 *
 * Walks the local tree (skipping dotfiles + the metadata dir) and uses
 * `hasConflictMarkers` to detect git-style merge markers written in-place
 * by SyncEngine's runOnce.
 *
 * Flags:
 *   --resolve   for each conflicted file, open it in $EDITOR, then prompt
 *               "resolved?".  After confirmation, the next sync picks up
 *               the user's resolution.
 */
import { promises as fs }    from 'node:fs';
import { spawn }              from 'node:child_process';
import { join, relative }     from 'node:path';

import { hasConflictMarkers } from '../applyConflict.js';

import { requireConfig }            from './_config.js';
import { confirm, closePrompt }     from './_prompt.js';

export async function conflictsCmd(args) {
  try {
    return await _conflicts(args);
  } finally {
    closePrompt();
  }
}

async function _conflicts(args) {
  const cfg     = await requireConfig();
  const resolve = args.includes('--resolve');

  const conflicted = [];
  await walk(cfg.localRoot, cfg.localRoot, conflicted);

  if (conflicted.length === 0) {
    console.log('no conflicts.');
    return;
  }

  console.log(`${conflicted.length} conflicted file(s):`);
  for (const abs of conflicted) {
    console.log('  ', relative(cfg.localRoot, abs));
  }

  if (!resolve) return;

  const editor = process.env.EDITOR || process.env.VISUAL;
  if (!editor) {
    console.log('');
    console.log('--resolve requested but $EDITOR is unset.');
    console.log('Set $EDITOR (e.g. `export EDITOR=vim`) and re-run, or edit the files manually.');
    return;
  }

  for (const abs of conflicted) {
    console.log('');
    console.log(`opening ${relative(cfg.localRoot, abs)} in ${editor}…`);
    await runEditor(editor, abs);
    const text = await fs.readFile(abs, 'utf8').catch(() => '');
    if (hasConflictMarkers(text)) {
      console.log('  still contains conflict markers.');
      const skip = await confirm('skip this file for now?', true);
      if (!skip) {
        console.log('  aborting; re-run `folio conflicts --resolve` when ready.');
        return;
      }
    } else {
      console.log('  resolved.');
    }
  }
  console.log('');
  console.log('Run `folio sync` to push your resolutions to the pod.');
}

async function walk(root, dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;          // skip dotfiles + .onderling
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(root, full, out);
    } else if (e.isFile()) {
      // Cheap pre-filter: only inspect text-y files.
      if (!/\.(md|markdown|txt|json|html?|css)$/i.test(e.name)) continue;
      try {
        const text = await fs.readFile(full, 'utf8');
        if (hasConflictMarkers(text)) out.push(full);
      } catch { /* ignore */ }
    }
  }
}

function runEditor(editor, file) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(editor, [file], { stdio: 'inherit' });
    child.on('exit',  () => resolveP());
    child.on('error', (err) => rejectP(err));
  });
}
