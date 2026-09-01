// @vitest-environment node
// Logging (SEND TARGET) — the injected `sendReport` SINK that delivers the anonymous bug-report
// envelope over the host's peer/relay transport to a config-driven dev "bug-report bot".
// Proves: (a) the envelope arrives INTACT wrapped in a `{type:'bug-report', ...}` transport message;
// (b) it is STILL ANONYMOUS — no chatId/pseudonym/webid/handle in the JSON-stringified outgoing message,
// even when identity is smuggled into the source records; (c) a working send → {ok:true}; (d) the no-target
// path → {ok:false, reason:'no-target'} without throwing; (e) a THROWING send is caught → {ok:false}.

import { test, expect } from 'vitest';
import { buildReportEnvelope } from '../../src/log/bugReport.js';
import { createBugReportSink } from '../../src/log/bugReportSink.js';

// A realistic envelope built the way the surface builds it — from logger records that ALSO carry smuggled
// identity fields (which buildReportEnvelope drops by construction).
function anonymousEnvelope() {
  const records = [
    { t: 111, lvl: 'info', tag: 'feedback', code: 'emit', f: { kind: 'text' },
      chatId: 'thread-42', pseudonym: 'pk-abc', webid: 'https://alice.example/profile#me', handle: '@alice' },
    { t: 222, lvl: 'warn', tag: 'transport', code: 'retry', f: { n: 2 } },
  ];
  return buildReportEnvelope({ records, app: 'basis', version: '1.2.3', at: 1700000000000 });
}

const FORBIDDEN = ['chatId', 'pseudonym', 'webid', 'handle', 'thread-42', 'pk-abc', 'alice', '@alice'];

// (a) + (b) + (c) — a fake in-memory receiver captures the outgoing message.
test('sink forwards the anonymous envelope intact, still anonymous, and returns ok', async () => {
  const captured = [];
  const send = async (target, msg) => { captured.push({ target, msg }); };
  const sink = createBugReportSink({ send, target: 'fp-bugreport-dev@FAKE', app: 'basis', version: '1.2.3' });

  const env = anonymousEnvelope();
  const res = await sink(env);

  // (c) ok
  expect(res).toEqual({ ok: true });
  expect(captured.length).toBe(1);

  // routed to the configured target
  expect(captured[0].target).toBe('fp-bugreport-dev@FAKE');

  // (a) envelope arrives intact, wrapped in the transport type tag
  const { msg } = captured[0];
  expect(msg.type).toBe('bug-report');
  expect(msg.kind).toBe('bug-report');
  expect(msg.at).toBe(1700000000000);
  expect(msg.app).toBe('basis');
  expect(msg.version).toBe('1.2.3');
  expect(msg.n).toBe(2);
  expect(msg.log).toContain('feedback/emit');
  expect(msg.log).toContain('transport/retry');

  // (b) STILL anonymous — nothing identity-shaped survived onto the wire message.
  const wire = JSON.stringify(msg);
  for (const forbidden of FORBIDDEN) expect(wire).not.toContain(forbidden);
  expect(msg).not.toHaveProperty('chatId');
  expect(msg).not.toHaveProperty('pseudonym');
  expect(msg).not.toHaveProperty('webid');
  expect(msg).not.toHaveProperty('handle');
  // exactly the type tag + the envelope's own fields — no extra keys smuggled in.
  expect(Object.keys(msg).sort()).toEqual(['app', 'at', 'kind', 'log', 'n', 'type', 'version']);
});

// The sink must never re-shape or ENRICH the payload with identity — even the sender's own address is the
// transport's concern (the `target`/`send` args), never part of the message body.
test('sink adds no identity of its own — sender address stays out of the payload', async () => {
  let seenTarget = null;
  const send = async (target, msg) => { seenTarget = target; /* address used for ROUTING only */ };
  const sink = createBugReportSink({ send, target: 'fp-bugreport-dev@FAKE' });
  const env = anonymousEnvelope();
  await sink(env);
  expect(seenTarget).toBe('fp-bugreport-dev@FAKE');
  // the message the surface handed us is unchanged in identity terms (proven above); here we assert the
  // envelope object itself was not mutated with any routing/identity field.
  expect(env).not.toHaveProperty('type');
  expect(env).not.toHaveProperty('target');
});

// (d) — no transport OR no target degrades to copy-only, never throws.
test('no-target: missing send → {ok:false, reason:no-target}, no throw', async () => {
  const sink = createBugReportSink({ target: 'fp-bugreport-dev@FAKE' });   // send omitted
  await expect(sink(anonymousEnvelope())).resolves.toEqual({ ok: false, reason: 'no-target' });
});

test('no-target: falsy target → {ok:false, reason:no-target}, no throw', async () => {
  const send = async () => { throw new Error('should not be called'); };
  const sink = createBugReportSink({ send, target: null });   // the shipped default (real address not built yet)
  await expect(sink(anonymousEnvelope())).resolves.toEqual({ ok: false, reason: 'no-target' });
});

// (e) — a throwing send is caught, surfaced as failure, not propagated.
test('a throwing send is caught → {ok:false} with the error reason', async () => {
  const send = async () => { throw new Error('relay down'); };
  const sink = createBugReportSink({ send, target: 'fp-bugreport-dev@FAKE' });
  const res = await sink(anonymousEnvelope());
  expect(res.ok).toBe(false);
  expect(res.reason).toBe('relay down');
});

// Defensive backfill: `clock`/`app`/`version` only fill fields the caller omitted — never override, never add
// identity. (The surface normally supplies `at`/`app`/`version`, so this path is belt-and-braces.)
test('defensive backfill stamps only missing at/app/version', async () => {
  const captured = [];
  const send = async (target, msg) => { captured.push(msg); };
  const sink = createBugReportSink({ send, target: 'fp-bugreport-dev@FAKE', clock: () => 999, app: 'basis', version: '9.9' });
  // an envelope missing at/app/version (e.g. buildReportEnvelope with no metadata → app/version null)
  await sink({ kind: 'bug-report', log: '', n: 0, app: null, version: null });
  const msg = captured[0];
  expect(msg.at).toBe(999);            // stamped from clock
  expect(msg.app).toBe('basis'); // backfilled (was null)
  expect(msg.version).toBe('9.9');     // backfilled (was null)
  const wire = JSON.stringify(msg);
  for (const forbidden of FORBIDDEN) expect(wire).not.toContain(forbidden);
});
