/**
 * Logging + bug reports across THREE devices — stories 12.1 + 12.2 of
 * `plans/NOTE-multi-device-user-stories.md`.
 *
 * This is the one cross-cutting story in the corpus, and it has a property the others don't: the bug-report
 * path is the only place where data deliberately LEAVES the trust boundary, sent by the user to a third
 * party. Everything the ring buffer holds when they press send is disclosed.
 *
 *   • 12.1 — a report Anna sends must carry nothing about Bram or Cato, and must not be a circle post.
 *   • 12.2 — three devices perform the SAME operation; no device's log may carry another's identifiers.
 *
 * Per-package PII tests already cover the transport / pod / llm call sites
 * (`packages/{transports,pod-client,llm-client}/test/logging.pii.test.js`), each with its own allow-list.
 * What none of them can express is the multi-device question — whether MY log holds YOUR identity — or the
 * question underneath it: what the logger itself guarantees, as opposed to what each call site remembers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { log, dumpLogs, clearLogs, formatLogs, configureLog, REDACTED } from '@onderling/logger';
import { buildReportEnvelope } from '../../src/feedback/bugReport.js';
import { createBugReportSink } from '../../src/feedback/bugReportSink.js';

/** Realistic identifiers — an NKN peer address is `label.<64 hex>`, so it is long AND high-entropy. */
const BRAM_ADDR = 'bram-phone.9f3c1a77b2e45d8091ac6be2130f47da55c8e91b0d3a72f6c4519e8ab7d206fe';
const CATO_WEBID = 'https://cato.solidcommunity.net/profile/card#me';
const CATO_ADDR = 'cato-laptop.11bb22cc33dd44ee55ff66007788990011223344556677889900aabbccddeeff';

/** Every identifier that must never appear in Anna's log or in what she sends. */
const FOREIGN = [BRAM_ADDR, CATO_WEBID, CATO_ADDR, 'bram-phone', 'cato-laptop', 'cato.solidcommunity.net'];

/** Assert a blob mentions none of the others — case-insensitively, and on PREFIXES too, since a truncated
 *  identifier is still an identifier. */
function expectNoForeignIdentity(blob, label) {
  const hay = (typeof blob === 'string' ? blob : JSON.stringify(blob ?? null)).toLowerCase();
  for (const secret of FOREIGN) {
    expect(hay, `${label} leaked "${secret}"`).not.toContain(secret.toLowerCase());
    // …and the first 24 chars of it, which is what a truncating sanitiser would leave behind.
    expect(hay, `${label} leaked a PREFIX of "${secret}"`).not.toContain(secret.slice(0, 24).toLowerCase());
  }
}

beforeEach(() => {
  configureLog({ min: 10, sink: null, max: 500 });
  clearLogs();
});

describe('12.1 — an anonymous bug report stays anonymous in a populated circle', () => {
  it('the envelope carries no identity of ANY member, not just not the sender\'s', () => {
    // Anna's device has been busy in a circle with Bram and Cato. Whatever the log holds, the envelope is
    // built from `formatLogs()` — so the log IS the disclosure surface.
    log.info('transport', 'connect', { multi: true, seeded: 2 });
    log.info('feedback', 'emit', { kind: 'text', btns: 0 });

    const envelope = buildReportEnvelope({ records: dumpLogs(), app: 'basis', version: '1.2.3', at: 1 });
    expect(Object.keys(envelope).sort()).toEqual(['app', 'at', 'kind', 'log', 'n', 'version']);
    expectNoForeignIdentity(envelope, 'the report envelope');
  });

  it('is sent to ONE configured sink, never fanned to the circle', async () => {
    const sends = [];
    const sink = createBugReportSink({
      send: async (target, payload) => { sends.push({ target, payload }); return { ok: true }; },
      target: 'bugbot.deadbeef', clock: () => 1, app: 'basis', version: '1.2.3',
    });
    const res = await sink(buildReportEnvelope({ records: dumpLogs(), app: 'basis', version: '1.2.3', at: 1 }));

    expect(res.ok).toBe(true);
    // EXACTLY one send, to the bug-report target — not one per member, and never a member's address.
    expect(sends).toHaveLength(1);
    expect(sends[0].target).toBe('bugbot.deadbeef');
    expect(FOREIGN).not.toContain(sends[0].target);
    expectNoForeignIdentity(sends[0].payload, 'the wire payload');
  });

  it('with no target it FAILS CLOSED — it does not fall back to posting in the circle', async () => {
    const sends = [];
    const sink = createBugReportSink({
      send: async (t, p) => { sends.push({ t, p }); return { ok: true }; },
      target: null, clock: () => 1,
    });
    const res = await sink(buildReportEnvelope({ records: dumpLogs() }));

    expect(res).toMatchObject({ ok: false, reason: 'no-target' });
    expect(sends).toHaveLength(0);      // the report went NOWHERE — the safe end of a misconfiguration
  });
});

describe('12.2 — three devices, one operation: no device\'s log holds another\'s identity', () => {
  /** What the shipped call sites actually log for a peer send — counts and outcome labels, never the peer. */
  const logAPeerSend = (bytes) => {
    log.info('transport', 'send', { bytes });
    log.info('transport', 'connect', { multi: false, seeded: 1 });
  };

  it('Anna logging a send to Bram records the SIZE, not the recipient', () => {
    logAPeerSend(JSON.stringify({ to: BRAM_ADDR, body: 'hallo' }).length);
    const mine = dumpLogs().filter((r) => r.tag === 'transport');
    expect(mine.length).toBeGreaterThan(0);                 // non-vacuous: there is something to inspect
    expectNoForeignIdentity(formatLogs(mine), 'Anna\'s transport log');
  });

  it('all three devices log the same operation and none holds the others\' identifiers', () => {
    // One buffer per device, captured by dumping between runs (the ring buffer is module state).
    const perDevice = {};
    for (const [me, peers] of [['anna', [BRAM_ADDR, CATO_ADDR]], ['bram', [CATO_ADDR]], ['cato', [BRAM_ADDR]]]) {
      clearLogs();
      for (const p of peers) logAPeerSend(JSON.stringify({ to: p, body: 'x' }).length);
      perDevice[me] = formatLogs(dumpLogs());
    }
    for (const [who, blob] of Object.entries(perDevice)) expectNoForeignIdentity(blob, `${who}'s log`);
  });

  it('a nested object field is DROPPED, so an identity cannot ride in as a container', () => {
    log.info('peer', 'hello', { identity: { webid: CATO_WEBID, addr: CATO_ADDR }, peers: [BRAM_ADDR] });
    const rec = dumpLogs().find((r) => r.code === 'hello');
    expect(rec.f).toBeUndefined();                          // both containers dropped ⇒ no fields at all
    expectNoForeignIdentity(formatLogs(dumpLogs()), 'the container log');
  });

  it('an error is logged by NAME, so a message carrying an identifier cannot ride along', () => {
    // The shipped convention at every call site: `err: String(e?.name)`, never `e.message`.
    const err = new Error(`failed to reach ${CATO_WEBID}`);
    log.error('transport', 'send.fail', { err: String(err.name), transient: false });
    expectNoForeignIdentity(formatLogs(dumpLogs()), 'the error log');
  });

  // ✅ FIXED 2026-07-26. Everything above held because each CALL SITE was careful; the logger itself
  // guaranteed nothing — `sanitize` merely TRUNCATED at 48 chars, and 48 chars of a peer address is still
  // an identifier. The facade now redacts identifier-SHAPED values whatever field name they arrive under,
  // so one forgetful call site no longer discloses a person through the bug-report flow.
  it('the LOGGER redacts an identifier-shaped value, whatever the call site passes', () => {
    log.info('somewhere', 'oops', { addr: BRAM_ADDR, who: CATO_WEBID, addr2: CATO_ADDR });
    expectNoForeignIdentity(formatLogs(dumpLogs()), 'a careless call site');
  });

  it('the redaction keeps the LENGTH — enough to debug with, not enough to identify', () => {
    log.info('somewhere', 'oops', { addr: BRAM_ADDR });
    const rec = dumpLogs().find((r) => r.code === 'oops');
    expect(rec.f.addr).toBe(`${REDACTED}:${BRAM_ADDR.length}`);
    expect(rec.f.addr).not.toContain('bram-phone');        // the label goes too, not just the key material
  });

  it('ordinary log fields are UNTOUCHED — the check must not eat the logs it protects', () => {
    // The control that keeps the fix proportionate. Every one of these is a real shipped field from
    // transports / pod-client / llm-client / feedback; if any starts redacting, the heuristic over-reached.
    log.info('transport', 'send', { bytes: 42, multi: true, seeded: 2, transient: false });
    log.error('transport', 'send.fail', { err: 'RangeError', reason: 'no-target' });
    log.info('llm', 'request', { provider: 'ollama', model: 'qwen2.5:7b-instruct', endpoint: 'enclave', msgs: 3 });
    log.info('pod', 'write', { bytes: 120, ms: 8, conditional: true, op: 'PUT', code: 'ok', status: 200 });
    log.info('feedback', 'report.sent', { ok: true, reason: '', n: 12 });

    const blob = formatLogs(dumpLogs());
    expect(blob).not.toContain(REDACTED);
    expect(blob).toContain('qwen2.5:7b-instruct');         // a model id survives: dots+digits, but no long run
    expect(blob).toContain('RangeError');
  });

  it('a long letters-only string is still merely TRUNCATED, not redacted', () => {
    log.warn('llm', 'clean.slow', { note: 'x'.repeat(200) });
    const rec = dumpLogs().find((r) => r.code === 'clean.slow');
    expect(rec.f.note.length).toBeLessThanOrEqual(49);
    expect(rec.f.note).not.toContain(REDACTED);
  });
});
