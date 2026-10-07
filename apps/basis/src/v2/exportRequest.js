/**
 * exportRequest — how the box's updater asks the RUNNING assistant for a fresh export before it changes anything.
 *
 * Two small files in the exports dir: the updater (through `bin/export-now.mjs`, run inside the assistant's container)
 * writes a request; the runner's tick job answers it through the export shelf and writes the answer. One process holds
 * the household's store — the runner — so nothing else ever opens it beside it. A request without an answer in time is
 * a failed export, and the updater holds the update.
 */
import { randomBytes } from 'node:crypto';

export const EXPORT_REQUEST_FILE = '.export-request.json';
export const EXPORT_ANSWER_FILE = '.export-answer.json';

const readJson = async (files, name) => { try { return JSON.parse(await files.read(name)); } catch { return null; } };

/**
 * The runner's side: a job on the host's tick. A waiting request is answered once.
 * @param {object} a
 * @param {{read: Function, write: Function, remove: Function}} a.files   the exports dir
 * @param {{writeNow: (o?: {preUpdateSha?: string}) => Promise<string|null>}} a.shelf
 */
export function createExportRequestJob({ files, shelf }) {
  return {
    async run() {
      const req = await readJson(files, EXPORT_REQUEST_FILE);
      if (!req || typeof req.id !== 'string') return;
      await files.remove(EXPORT_REQUEST_FILE);
      const name = await shelf.writeNow({ preUpdateSha: typeof req.sha === 'string' ? req.sha : 'unknown' });
      await files.write(EXPORT_ANSWER_FILE, JSON.stringify(name
        ? { id: req.id, ok: true, name, at: new Date().toISOString() }
        : { id: req.id, ok: false, error: 'export-failed', at: new Date().toISOString() }));
    },
  };
}

/**
 * The asking side (`bin/export-now.mjs`): drop a request, wait for ITS answer.
 * @returns {Promise<{ok: true, name: string}|{ok: false, error: string}>}
 */
export async function requestExportNow({ files, sha, timeoutMs = 150_000, pollMs = 1000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const id = randomBytes(8).toString('hex');
  await files.remove(EXPORT_ANSWER_FILE).catch(() => {});
  await files.write(EXPORT_REQUEST_FILE, JSON.stringify({ id, sha: String(sha ?? ''), at: new Date(now()).toISOString() }));
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    await sleep(pollMs);
    const answer = await readJson(files, EXPORT_ANSWER_FILE);
    if (answer?.id === id) return answer.ok ? { ok: true, name: answer.name } : { ok: false, error: answer.error ?? 'export-failed' };
  }
  await files.remove(EXPORT_REQUEST_FILE).catch(() => {});   // taken back: a late runner must not export for nobody
  return { ok: false, error: 'timeout' };
}
