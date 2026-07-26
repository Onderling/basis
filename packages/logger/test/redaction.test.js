/**
 * @onderling/logger — the PII guarantee, tested where it LIVES.
 *
 * Until 2026-07-26 this package had no tests at all: the only coverage was in `apps/basis/test/log/`, and
 * the package's privacy claim ("PII-safe by construction") rested on every call site remembering the rule
 * in the module header. That is the wrong place for a guarantee the bug-report flow ships to a third party
 * — and it is a publishable package, so a consumer gets the claim without the check.
 *
 * The property under test: an identifier-shaped value is REDACTED whatever field name it arrives under,
 * while the ordinary log fields the codebase actually uses pass through untouched. Both halves matter — a
 * sanitiser that eats real fields gets configured away, and then protects nothing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { log, dumpLogs, clearLogs, formatLogs, configureLog, REDACTED } from '../src/index.js';

const NKN_ADDR = 'bram-phone.9f3c1a77b2e45d8091ac6be2130f47da55c8e91b0d3a72f6c4519e8ab7d206fe';
const WEBID = 'https://cato.solidcommunity.net/profile/card#me';
const POD_URI = 'https://pod.example/alice/private/notes.ttl';
const PUBKEY = '11bb22cc33dd44ee55ff66007788990011223344556677889900aabbccddeeff';

const fieldsOf = (code) => dumpLogs().find((r) => r.code === code)?.f;

beforeEach(() => { configureLog({ min: 10, sink: null, max: 500 }); clearLogs(); });

describe('identifier-shaped values are redacted, whatever they are called', () => {
  it.each([
    ['an NKN peer address', NKN_ADDR],
    ['a webid', WEBID],
    ['a pod resource URI', POD_URI],
    ['a bare public key', PUBKEY],
    ['an email address', 'anna@example.org'],
  ])('%s is replaced by the marker', (_label, value) => {
    log.info('x', 'c', { anything: value });
    expect(fieldsOf('c').anything).toBe(`${REDACTED}:${value.length}`);
  });

  it('the FIELD NAME is irrelevant — the leak arrives under the name nobody deny-listed', () => {
    // A key-name deny-list only catches the names someone thought of. These are the ones they didn't.
    log.info('x', 'c', { who: NKN_ADDR, target: WEBID, from: PUBKEY, msg: POD_URI, note: NKN_ADDR });
    for (const [k, v] of Object.entries(fieldsOf('c'))) {
      expect(v, `field ${k} was not redacted`).toContain(REDACTED);
    }
  });

  it('redaction takes the WHOLE value — the human-readable half is identifying too', () => {
    log.info('x', 'c', { addr: NKN_ADDR });
    expect(fieldsOf('c').addr).not.toContain('bram-phone');   // not just the key material
  });

  it('the length survives, so a report is still debuggable', () => {
    log.info('x', 'c', { addr: NKN_ADDR });
    expect(fieldsOf('c').addr).toBe(`${REDACTED}:${NKN_ADDR.length}`);
  });

  it('nothing identifier-shaped survives into `formatLogs`, which is what the bug report ships', () => {
    log.info('x', 'a', { addr: NKN_ADDR });
    log.error('x', 'b', { who: WEBID });
    const blob = formatLogs(dumpLogs());
    for (const secret of ['bram-phone', 'cato.solidcommunity.net', PUBKEY.slice(0, 20)]) {
      expect(blob).not.toContain(secret);
    }
  });
});

describe('the ordinary log fields this codebase uses are UNTOUCHED', () => {
  it('the real shipped fields all pass through', () => {
    // Every one of these is a live field from transports / pod-client / llm-client / feedback. If the
    // heuristic ever eats one of them, it has over-reached and the logs stop being worth keeping.
    log.info('transport', 'send', { bytes: 42, multi: true, seeded: 2, transient: false });
    log.error('transport', 'send.fail', { err: 'RangeError', reason: 'no-target' });
    log.info('pod', 'write', { bytes: 120, ms: 8, conditional: true, op: 'PUT', code: 'ok', status: 200 });
    log.info('llm', 'request', { provider: 'ollama', model: 'qwen2.5:7b-instruct', endpoint: 'enclave', msgs: 3 });
    log.info('feedback', 'report.sent', { ok: true, reason: '', n: 12 });

    expect(formatLogs(dumpLogs())).not.toContain(REDACTED);
  });

  it('letters-only prose is truncated, not redacted — an error slug stays readable', () => {
    log.warn('llm', 'clean.slow', { note: 'x'.repeat(200), msg: 'TimeoutWhileConnectingToRelay' });
    const f = fieldsOf('clean.slow');
    expect(f.note).not.toContain(REDACTED);
    expect(f.note.length).toBeLessThanOrEqual(49);
    expect(f.msg).toBe('TimeoutWhileConnectingToRelay');
  });

  it('a version / model string with dots and digits is not mistaken for a token', () => {
    log.info('app', 'boot', { version: '1.2.3', model: 'qwen2.5:7b-instruct', build: 'v2026.07.26' });
    expect(formatLogs(dumpLogs())).not.toContain(REDACTED);
  });
});

describe('the structural guarantees still hold', () => {
  it('containers are dropped entirely — an identity cannot ride in nested', () => {
    log.info('x', 'c', { identity: { webid: WEBID }, peers: [NKN_ADDR], fn: () => {}, nil: null });
    expect(fieldsOf('c')).toBeUndefined();
  });

  it('there is no free-text message parameter to misuse', () => {
    const rec = log.info('x', 'c', 'a raw secret message');
    expect(rec.f).toBeUndefined();          // a non-object `fields` is ignored, not stringified
  });

  it('the ring stays bounded and `clearLogs` truncates in place', () => {
    configureLog({ max: 3 });
    for (let i = 0; i < 5; i += 1) log.info('x', `c${i}`, { i });
    expect(dumpLogs()).toHaveLength(3);
    expect(dumpLogs()[0].code).toBe('c2');  // oldest dropped
    clearLogs();
    expect(dumpLogs()).toHaveLength(0);
  });

  it('a throwing sink never breaks logging', () => {
    configureLog({ sink: () => { throw new Error('sink down'); } });
    expect(() => log.info('x', 'c', { n: 1 })).not.toThrow();
    expect(fieldsOf('c')).toEqual({ n: 1 });
  });
});
