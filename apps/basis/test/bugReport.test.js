// @vitest-environment node
// Logging (client half) — the ANONYMOUS bug-report SEND affordance + adapter.
// Proves: (a) the envelope carries NO identity even when junk is smuggled in; (b) it includes the
// formatted PII-safe log + count + the INJECTED `at`; (c) the surface calls the injected sink on send
// and surfaces ok/fail; (d) the default (no injected sink) path is safe — reason:'no-sink', no throw.

import { test, expect, beforeAll, afterAll } from 'vitest';
import { startMockLlm } from 'onderling-feedback/testing';
import { InMemoryCentralPod } from 'onderling-feedback/public';
import { log, clearLogs } from '@onderling/logger';
import { buildReportEnvelope } from '../src/log/bugReport.js';
import { createFeedbackSurface } from '../src/feedback/feedbackSurface.js';
import { loadFeedbackPackage } from '../src/feedback/feedbackPackage.js';

let mock;
beforeAll(async () => { await loadFeedbackPackage(); mock = await startMockLlm(); });
afterAll(async () => { await mock.close(); });

const cfg = (extra = {}) => ({
  projectId: 'basis', llm: { route: 'local', model: 'mock', baseURL: mock.url }, aggregation: { k: 1 },
  signal: { layer1OnDevice: true, escalationCategories: ['crisis'] }, ...extra,
});

function setup(opts = {}) {
  const replies = [];
  const pod = opts.pod || new InMemoryCentralPod();
  const surface = createFeedbackSurface({ config: cfg(opts.configExtra), pod, emit: (r) => replies.push(r), ...opts.surface });
  return { surface, pod, replies };
}

// (a) + (b) — the pure packager.
test('buildReportEnvelope — anonymous by construction: no identity fields leak, even from junk input', () => {
  // Records shaped like real logger dumps, but each also carries smuggled identity fields.
  const records = [
    { t: 111, lvl: 'info', tag: 'feedback', code: 'emit', f: { kind: 'text' },
      chatId: 'thread-42', pseudonym: 'pk-abc', webid: 'https://alice.example/profile#me', handle: '@alice' },
    { t: 222, lvl: 'warn', tag: 'transport', code: 'retry', f: { n: 2 },
      chatId: 'thread-42', pseudonym: 'pk-abc' },
  ];
  const env = buildReportEnvelope({
    records, app: 'basis', version: '1.2.3', at: 1700000000000,
    // extra junk args are ignored (never copied onto the envelope)
    chatId: 'x', pseudonym: 'y', webid: 'z', handle: 'h',
  });

  // (a) NO identity anywhere on the envelope.
  const flat = JSON.stringify(env);
  for (const forbidden of ['chatId', 'pseudonym', 'webid', 'handle', 'thread-42', 'pk-abc', 'alice', '@alice']) {
    expect(flat).not.toContain(forbidden);
  }
  expect(env).not.toHaveProperty('chatId');
  expect(env).not.toHaveProperty('pseudonym');
  expect(env).not.toHaveProperty('webid');
  expect(env).not.toHaveProperty('handle');
  expect(Object.keys(env).sort()).toEqual(['app', 'at', 'kind', 'log', 'n', 'version']);

  // (b) includes the formatted log + count + the INJECTED at.
  expect(env.kind).toBe('bug-report');
  expect(env.at).toBe(1700000000000);
  expect(env.app).toBe('basis');
  expect(env.version).toBe('1.2.3');
  expect(env.n).toBe(2);
  expect(env.log).toContain('feedback/emit');    // formatLogs render (codes + scalar fields only)
  expect(env.log).toContain('transport/retry');
  expect(env.log).toContain('{"kind":"text"}');   // safe scalar field survives
});

test('buildReportEnvelope — empty / missing inputs are safe', () => {
  const env = buildReportEnvelope({ at: 5 });
  expect(env).toEqual({ kind: 'bug-report', at: 5, app: null, version: null, log: '', n: 0 });
  expect(buildReportEnvelope()).toMatchObject({ kind: 'bug-report', n: 0, log: '' });
});

// (c) — the surface drives the injected sink and surfaces the outcome.
test('surface send — builds an anonymous envelope, calls the injected sink, surfaces OK', async () => {
  clearLogs();
  const sent = [];
  const sendReport = async (env) => { sent.push(env); return { ok: true }; };
  const { surface, replies } = setup({ surface: { sendReport, app: 'basis', version: '9.9' } });
  await surface.start('s1');
  log.info('feedback', 'probe', { n: 1 });   // something in the buffer to package
  replies.length = 0;

  const res = await surface.handle('fp:report:send', 's1');
  expect(res).toBe(true);                       // handled as a surface affordance
  expect(sent.length).toBe(1);
  expect(sent[0].kind).toBe('bug-report');
  expect(sent[0].app).toBe('basis');
  expect(sent[0].version).toBe('9.9');
  expect(typeof sent[0].at).toBe('number');     // injected at the call site
  expect(sent[0]).not.toHaveProperty('chatId'); // no thread identity in the envelope
  // the result bubble is the localised success line (nl is the config default)
  expect(replies.at(-1).kind).toBe('report-result');
  expect(replies.at(-1).text).toMatch(/verstuurd|sent/i);
});

test('surface send — a failing sink surfaces the localised failure (never throws)', async () => {
  const sendReport = async () => ({ ok: false, reason: 'network' });
  const { surface, replies } = setup({ surface: { sendReport } });
  await surface.start('s2');
  replies.length = 0;
  await surface.reportSend('s2');
  expect(replies.at(-1).kind).toBe('report-result');
  expect(replies.at(-1).text).toMatch(/niet gelukt|failed/i);
});

test('surface send — a THROWING sink is caught and surfaced as failure, not propagated', async () => {
  const sendReport = async () => { throw new Error('boom'); };
  const { surface, replies } = setup({ surface: { sendReport } });
  await surface.start('s3');
  replies.length = 0;
  await expect(surface.reportSend('s3')).resolves.toBeTruthy();   // resolves (no throw)
  expect(replies.at(-1).text).toMatch(/niet gelukt|failed/i);
});

// (d) — the default (no injected sink) path is safe.
test('surface send — default no-sink path returns reason:no-sink and never throws', async () => {
  const { surface, replies } = setup();   // no sendReport injected
  await surface.start('d1');
  replies.length = 0;
  const res = await surface.reportSend('d1');
  expect(res).toEqual({ ok: false, reason: 'no-sink' });
  expect(replies.at(-1).kind).toBe('report-result');
  expect(replies.at(-1).text).toMatch(/set up|ingesteld/i);   // the no_sink line
});

test('report panel — the open trigger offers the anonymous Send button', async () => {
  const { surface, replies } = setup();
  await surface.start('p1');
  replies.length = 0;
  await surface.handle('/report', 'p1');
  const panel = replies.at(-1);
  expect(panel.kind).toBe('report');
  expect((panel.buttons || []).some((b) => b.id === 'fp:report:send')).toBe(true);
});
