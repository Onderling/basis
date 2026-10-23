/**
 * The "copy log / report a problem" door's one text, web ≡ mobile: the anonymous report envelope
 * (`buildReportEnvelope`, codes + scalar fields only) rendered as the exact text the person sees and copies.
 * Nothing leaves the device from this door; the person decides where the copied text goes.
 */
import { dumpLogs } from '@onderling/logger';
import { buildReportEnvelope } from './bugReport.js';

/**
 * @param {object} a
 * @param {string|null} [a.version]  the build's version (null on a dev build)
 * @param {number} a.at              injected timestamp (epoch ms)
 * @param {Array} [a.records]        the logger dump; defaults to this device's ring buffer
 * @returns {{ text: string, n: number }}
 */
export function logReportView({ version = null, at, records = dumpLogs() } = {}) {
  const env = buildReportEnvelope({ records, app: 'basis', version: version || null, at });
  const head = `${env.kind} · ${env.app} ${env.version ?? 'dev'} · ${new Date(env.at).toISOString()} · ${env.n}`;
  return { text: env.n ? `${head}\n\n${env.log}` : head, n: env.n };
}
