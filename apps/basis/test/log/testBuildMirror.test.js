import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { log, clearLogs, configureLog } from '@onderling/logger';
import { attachTestBuildLogMirror, TEST_BUILD_LOG_PREFIX } from '../../src/log/testBuildMirror.js';

describe('the test-build log mirror', () => {
  beforeEach(() => { clearLogs(); configureLog({ min: 'debug', sink: null }); });

  it('attaches nothing without the flag: a record reaches no console line', () => {
    const lines = [];
    expect(attachTestBuildLogMirror(undefined, { write: (l) => lines.push(l) })).toBe(false);
    log.info('boot', 'agent.ready', { ms: 120 });
    expect(lines).toEqual([]);
  });

  it('attaches nothing for any value but exactly "1"', () => {
    const lines = [];
    for (const v of ['', '0', 'true', 'yes', ' 1']) attachTestBuildLogMirror(v, { write: (l) => lines.push(l) });
    log.info('boot', 'agent.ready');
    expect(lines).toEqual([]);
  });

  it('with the flag, mirrors the logger\'s own formatted line, identifiers still redacted', () => {
    const lines = [];
    expect(attachTestBuildLogMirror('1', { write: (l) => lines.push(l) })).toBe(true);
    log.info('boot', 'relay.connected', { ms: 340, url: 'wss://relay.example.org/some/path' });
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith(`${TEST_BUILD_LOG_PREFIX} `)).toBe(true);
    expect(lines[0]).toContain('boot/relay.connected');
    expect(lines[0]).toContain('"ms":340');
    expect(lines[0]).not.toContain('relay.example.org');
  });

  it('no committed file sets the flag: it only ever comes from the builder\'s shell', () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    let hits = '';
    try { hits = execFileSync('git', ['grep', '-l', 'EXPO_PUBLIC_TEST_BUILD'], { cwd: root, encoding: 'utf8' }); }
    catch (e) { if (e.status !== 1) throw e; }
    const allowed = new Set([
      'apps/basis/src/log/testBuildMirror.js',
      'apps/basis/test/log/testBuildMirror.test.js',
      'apps/basis-mobile/index.js',
    ]);
    expect(hits.split('\n').filter(Boolean).filter((f) => !allowed.has(f))).toEqual([]);
  });
});

describe('the copy-log door text', () => {
  beforeEach(() => { clearLogs(); configureLog({ min: 'debug', sink: null, clock: () => 1000 }); });

  it('is the anonymous envelope as text: header + the logger lines, identifiers redacted', async () => {
    const { logReportView } = await import('../../src/log/logReport.js');
    log.warn('relay', 'connect.failed', { tries: 3, url: 'wss://relay.example.org' });
    const v = logReportView({ version: 'v0.1.72-alpha', at: Date.UTC(2026, 9, 23) });
    expect(v.n).toBe(1);
    expect(v.text.split('\n')[0]).toBe('bug-report · basis v0.1.72-alpha · 2026-10-23T00:00:00.000Z · 1');
    expect(v.text).toContain('relay/connect.failed');
    expect(v.text).not.toContain('relay.example.org');
  });

  it('says dev and 0 on an empty dev build', async () => {
    const { logReportView } = await import('../../src/log/logReport.js');
    expect(logReportView({ at: 0 }).text).toBe('bug-report · basis dev · 1970-01-01T00:00:00.000Z · 0');
  });
});

describe('the boot timeline and the stall watch', () => {
  beforeEach(() => { clearLogs(); configureLog({ min: 'debug', sink: null }); });

  it('marks each step with ms since the first mark and dt since the previous', async () => {
    const { bootMark, resetBootTimeline } = await import('../../src/log/bootTimeline.js');
    const { dumpLogs } = await import('@onderling/logger');
    resetBootTimeline();
    bootMark('js.start', {}, 1000);
    bootMark('agent.ready', {}, 1800);
    bootMark('launcher.paint', { circles: 2 }, 2100);
    const recs = dumpLogs().filter((r) => r.tag === 'boot');
    expect(recs.map((r) => [r.code, r.f.ms, r.f.dt])).toEqual([['js.start', 0, 0], ['agent.ready', 800, 800], ['launcher.paint', 1100, 300]]);
    expect(recs[2].f.circles).toBe(2);
  });

  it('logs a stall only when the timer fires later than allowed', async () => {
    const { startStallWatch } = await import('../../src/log/bootTimeline.js');
    const { dumpLogs } = await import('@onderling/logger');
    let tick = null; let t = 0;
    startStallWatch({ everyMs: 100, overMs: 200, now: () => t, setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => {} });
    t = 150; tick();          // 50 ms late: fine
    t = 650; tick();          // 400 ms late: a stall
    const stalls = dumpLogs().filter((r) => r.tag === 'jsthread');
    expect(stalls.map((r) => r.f.lag)).toEqual([400]);
  });
});
