// @vitest-environment node
// Integration test for hosting the feedback bot inside basis (M1.4 + M2). Proves the
// surface co-hosts the bot on a real InternalBus, drives the journey to the pod, SIGNS consent
// with the participant's identity (accepted by a verify pod), passes buttons through + handles
// taps, and parses a project-invite link. The bot OWNS the route (config.llm), no setLlmRoute.

import { test, expect, beforeAll, afterAll } from 'vitest';
import { startMockLlm } from 'onderling-feedback/testing';
import { InMemoryCentralPod } from 'onderling-feedback/public';
import { randomBytes } from 'node:crypto';
import { InternalBus, AgentIdentity } from '@onderling/core';
import { generateParticipantIdentity, IdentityRoster, makeContributionVerifier } from 'onderling-feedback/public';
import { loadFeedbackPackage } from '../../src/feedback/feedbackPackage.js';
import { createFeedbackSurface, parseFeedbackInvite, feedbackContactItem, signerForIdentity } from '../../src/feedback/feedbackSurface.js';

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

test('free text is ignored until /feedback, then routed to the bot', async () => {
  const { surface, replies } = setup();
  expect(await surface.handle('De GGZ wachtlijst is te lang', 't1')).toBe(false);
  await surface.start('t1');
  expect(replies.at(-1).text).toMatch(/Zo werkt het/);
  replies.length = 0;
  expect(await surface.handle('De wachtlijst bij de GGZ is veel te lang', 't1')).toBe(true);
  expect(replies.at(-1).text).toMatch(/Ontvangen/);
});

test('full journey over the shared bus: message -> klaar -> verstuur alles -> pod', async () => {
  const { surface, pod, replies } = setup();
  await surface.start('a');
  await surface.handle('De wachtlijst bij de GGZ is al maanden veel te lang', 'a');
  replies.length = 0;
  await surface.handle('ik ben klaar', 'a');
  expect(replies.at(-1).buttons?.some((b) => b.id === 'fp:consent:all')).toBe(true);   // buttons pass through
  await surface.handle('verstuur alles', 'a');
  expect(pod.list().length).toBe(1);
  expect(pod.list()[0].participant).toBe('cc:a');
});

test('consent is SIGNED with the participant identity (accepted by a verify pod)', async () => {
  const id = generateParticipantIdentity();
  const roster = new IdentityRoster();
  // The participant IS the on-device identity's public key (the surface's participantFor derives it from
  // the signer), so the roster binds that pubkey — distinct per identity, which is what keeps multiple
  // participants on the same invite/circle from collapsing to one pseudonym.
  roster.bind(id.publicKey, id.publicKey, id.encPublicKey);
  const pod = new InMemoryCentralPod({ verify: makeContributionVerifier({ roster, projectId: 'basis' }) });
  const replies = [];
  const surface = createFeedbackSurface({ config: cfg({ privacy: { verify: true } }), pod, identity: id, emit: (r) => replies.push(r) });

  await surface.start('s');
  await surface.handle('De GGZ-wachtlijst is veel te lang', 's');
  await surface.handle('ik ben klaar', 's');
  await surface.tapButton('fp:consent:all', 's');   // a button TAP drives consent
  expect(pod.forAggregation().length).toBe(1);        // signed → verified → aggregated
});

test('seam 4 — a signer CLOSURE (from the host AgentIdentity) signs consent, accepted by a verify pod', async () => {
  // The host hands the bot a { publicKey, sign() } closure, NOT the raw key (private key stays
  // encapsulated in the AgentIdentity). contributionMeta signs consent with it → a verify pod accepts.
  const agent = new AgentIdentity({ seed: new Uint8Array(randomBytes(32)), vault: {} });
  const signer = signerForIdentity(agent);
  expect(signer).toEqual({ publicKey: agent.pubKey, sign: expect.any(Function) });   // closure shape, no privateKey
  const roster = new IdentityRoster();
  roster.bind(signer.publicKey, signer.publicKey);   // participant = the identity's pubkey (see above)
  const pod = new InMemoryCentralPod({ verify: makeContributionVerifier({ roster, projectId: 'basis' }) });
  const replies = [];
  const surface = createFeedbackSurface({ config: cfg({ privacy: { verify: true } }), pod, identityFor: () => signer, emit: (r) => replies.push(r) });

  await surface.start('z');
  await surface.handle('De GGZ-wachtlijst is veel te lang', 'z');
  await surface.handle('ik ben klaar', 'z');
  await surface.tapButton('fp:consent:all', 'z');
  expect(pod.forAggregation().length).toBe(1);        // closure-signed → verified → aggregated
});

test('seam 4 — the signer is INERT for a non-verify project (no signing attempted)', async () => {
  // Gate: for a project WITHOUT privacy.verify (today's default), the surface wires no signer to the bot,
  // so consent writes stay unsigned exactly as before F2 — the injected sign() is never called.
  let signCalls = 0;
  const signer = { publicKey: 'ignored', sign: () => { signCalls += 1; return new Uint8Array(64); } };
  const { surface, pod } = setup({ surface: { identityFor: () => signer } });   // cfg() has no privacy.verify
  await surface.start('n');
  await surface.handle('De GGZ-wachtlijst is te lang', 'n');
  await surface.handle('ik ben klaar', 'n');
  await surface.tapButton('fp:consent:all', 'n');
  expect(pod.list().length).toBe(1);   // the write still lands (unsigned)
  expect(signCalls).toBe(0);           // no signer wired for a non-verify project
});

test('/report is intercepted as a surface affordance — emits a PII-safe log panel, never reaches the bot', async () => {
  const { surface, pod, replies } = setup();
  await surface.start('r');
  // A free-text turn the bot WOULD normally process — so we can prove /report doesn't get routed to it.
  await surface.handle('De GGZ-wachtlijst is veel te lang', 'r');
  const podBefore = pod.list().length;
  replies.length = 0;

  expect(await surface.handle('/report', 'r')).toBe(true);   // handled (returns true) …
  const panel = replies.at(-1);
  expect(panel.kind).toBe('report');                          // … as a report panel, not a bot reply
  expect(panel.report).toBe(true);
  expect(panel.text).toMatch(/probleem|problem/i);            // localised header + intro
  expect(typeof panel.logText).toBe('string');
  expect(pod.list().length).toBe(podBefore);                  // it did NOT write / drive the journey

  // The panel is PII-safe by construction: the typed feedback text must never appear in the log.
  expect(panel.logText).not.toMatch(/wachtlijst/);
  // The `fp:report` button (web bubble-trigger) routes to the same interception.
  replies.length = 0;
  expect(await surface.handle('fp:report', 'r')).toBe(true);
  expect(replies.at(-1).kind).toBe('report');
});

test('reportButton — start() offers the web bubble-trigger with an fp:report button', async () => {
  const { surface, replies } = setup({ surface: { reportButton: true } });
  await surface.start('rb');
  expect(replies.some((r) => (r.buttons || []).some((b) => b.id === 'fp:report'))).toBe(true);
});

test('charter consent — the opt-in walk releases a coarse attribute that rides the consented contribution', async () => {
  const pod = new InMemoryCentralPod();
  const replies = [];
  const surface = createFeedbackSurface({
    config: cfg({ charter: { attributes: [{ key: 'ageBand', purpose: 'age spread' }] } }),
    pod, emit: (r) => replies.push(r),
  });
  await surface.start('c');
  expect(replies.some((r) => (r.buttons || []).some((b) => b.id === 'fp:charter:start'))).toBe(true);  // charter offered

  await surface.handle('fp:charter:start', 'c');
  expect(replies.at(-1).buttons.some((b) => b.id === 'fp:charter:pick:ageBand:35-54')).toBe(true);      // bucket buttons
  await surface.handle('fp:charter:pick:ageBand:35-54', 'c');
  expect(replies.at(-1).buttons.some((b) => b.id === 'fp:charter:send')).toBe(true);                    // confirm → send
  await surface.handle('fp:charter:send', 'c');

  // now the ordinary feedback journey — the disclosed attribute rides the contribution
  await surface.handle('De GGZ-wachtlijst is veel te lang', 'c');
  await surface.handle('ik ben klaar', 'c');
  await surface.handle('verstuur alles', 'c');
  const agg = pod.forAggregation();
  expect(agg.length).toBe(1);
  expect(agg[0].attributes).toEqual({ ageBand: '35-54' });
});

test('privacy indicator — a per-circle status is shown after consent, with a ⚠ when the combo is identifying', async () => {
  const pod = new InMemoryCentralPod();
  const replies = [];
  // cohortHint = 8 (small) so the identifiability warning can fire; charter asks for 2 attributes.
  const surface = createFeedbackSurface({
    config: cfg({ cohortHint: 8, charter: { attributes: [{ key: 'ageBand', purpose: 'age' }, { key: 'role', purpose: 'role' }] } }),
    pod, emit: (r) => replies.push(r),
  });
  await surface.start('p');
  // share BOTH attributes → an identifying combo in a group of ~8
  await surface.handle('fp:charter:start', 'p');
  await surface.handle('fp:charter:pick:ageBand:35-54', 'p');
  await surface.handle('fp:charter:pick:role:resident', 'p');
  await surface.handle('fp:charter:send', 'p');

  const status = replies.filter((r) => r.kind === 'privacy').at(-1);
  expect(status).toBeTruthy();
  expect(status.level).toBe('risk');                 // ⚠ earned — the combo is likely identifying in ~8
  expect(status.text).toMatch(/⚠️/);
  // the queryable state a shell renders a badge from
  const st = surface.privacyState('p');
  expect(st).toMatchObject({ applicable: true, level: 'risk', reason: 'combo-identifiable' });
  expect(st.shared.sort()).toEqual(['ageBand', 'role']);
});

test('privacy warnings toggle — turning off while sharing flips to structural ⚠, acknowledged', async () => {
  const replies = [];
  const surface = createFeedbackSurface({ config: cfg({ charter: { attributes: [{ key: 'ageBand', purpose: 'age' }] } }), pod: new InMemoryCentralPod(), emit: (r) => replies.push(r) });
  await surface.start('w');
  await surface.handle('fp:charter:start', 'w');
  await surface.handle('fp:charter:pick:ageBand:35-54', 'w');
  await surface.handle('fp:charter:send', 'w');
  expect(surface.privacyState('w').level).toBe('sharing');   // warnings on, sharing, no combo risk

  await surface.handle('fp:privacy:info', 'w');
  const info = replies.filter((r) => r.kind === 'privacy').at(-1);
  expect(info.buttons.some((b) => b.id === 'fp:privacy:warnings:off')).toBe(true);   // toggle offered

  await surface.handle('fp:privacy:warnings:off', 'w');
  expect(surface.warningsMode).toBe('off');
  expect(replies.some((r) => /warnings are now off|waarschuwingen staan nu uit/i.test(r.text || ''))).toBe(true);   // acknowledged
  expect(surface.privacyState('w')).toMatchObject({ level: 'risk', reason: 'warnings-off' });   // structural ⚠
});

test('privacy indicator — quiet when nothing is shared', async () => {
  const replies = [];
  const surface = createFeedbackSurface({ config: cfg({ charter: { attributes: [{ key: 'ageBand', purpose: 'age' }] } }), pod: new InMemoryCentralPod(), emit: (r) => replies.push(r) });
  await surface.start('q');
  await surface.handle('fp:charter:skip', 'q');
  expect(replies.filter((r) => r.kind === 'privacy').at(-1).level).toBe('quiet');
  expect(surface.privacyState('q').level).toBe('quiet');
});

test('charter consent — skipping shares nothing (default withhold)', async () => {
  const pod = new InMemoryCentralPod();
  const surface = createFeedbackSurface({ config: cfg({ charter: { attributes: [{ key: 'ageBand', purpose: 'age' }] } }), pod, emit: () => {} });
  await surface.start('s');
  await surface.handle('fp:charter:skip', 's');
  await surface.handle('De GGZ-wachtlijst is veel te lang', 's');
  await surface.handle('ik ben klaar', 's');
  await surface.handle('verstuur alles', 's');
  expect(pod.forAggregation()[0].attributes).toBeUndefined();
});

test('start({ greet:false }) suppresses the onboarding greeting + affordances (restore-on-reload path)', async () => {
  const { surface, replies } = setup({ surface: { reportButton: true } });
  await surface.start('rb2', { greet: false });
  // no /help greeting and no affordance bubble — on reload these come back WITH the restored transcript instead,
  // so re-emitting would stack them in the stored history.
  expect(replies.some((r) => (r.buttons || []).some((b) => b.id === 'fp:report'))).toBe(false);
  expect(replies.length).toBe(0);
});

test('access affordance — start() offers backup + restore; backup reveals the phrase via revealOwnerPhrase', async () => {
  const calls = [];
  const callSkill = async (origin, opId, args) => {
    calls.push({ origin, opId, args });
    if (opId === 'revealOwnerPhrase') return { shown: false, mnemonic: 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima' };
    return {};
  };
  const replies = [];
  const surface = createFeedbackSurface({ config: cfg(), pod: new InMemoryCentralPod(), callSkill, accessButton: true, emit: (r) => replies.push(r) });
  await surface.start('acc');
  // onboarding offers the two access affordances as bubble-buttons
  const opts = replies.find((r) => r.kind === 'access' && Array.isArray(r.buttons));
  expect(opts.buttons.map((b) => b.id)).toEqual(['fp:access:backup', 'fp:access:restore']);
  // BACK UP → calls the host reveal skill on the household agent + surfaces the phrase
  replies.length = 0;
  expect(await surface.handle('fp:access:backup', 'acc')).toBe(true);
  expect(calls.some((c) => c.origin === 'household' && c.opId === 'revealOwnerPhrase')).toBe(true);
  expect(replies.at(-1).kind).toBe('access-reveal');
  expect(replies.at(-1).text).toContain('alpha bravo charlie');   // the phrase is surfaced
  expect(replies.at(-1).copyText).toMatch(/^alpha bravo/);         // copy affordance carries the phrase
});

test('access affordance — restore prompts, then a pasted phrase installs it via restoreOwnerPhrase', async () => {
  const calls = [];
  const callSkill = async (origin, opId, args) => { calls.push({ origin, opId, args }); return opId === 'restoreOwnerPhrase' ? { ok: true, reloadRequired: true } : {}; };
  const replies = [];
  const surface = createFeedbackSurface({ config: cfg(), pod: new InMemoryCentralPod(), callSkill, accessButton: true, emit: (r) => replies.push(r) });
  await surface.start('rst'); replies.length = 0;
  // RESTORE → prompts for a phrase (no skill call yet)
  expect(await surface.handle('fp:access:restore', 'rst')).toBe(true);
  expect(replies.at(-1).kind).toBe('access');
  expect(calls.some((c) => c.opId === 'restoreOwnerPhrase')).toBe(false);
  // a 12-word phrase is treated as the pasted mnemonic → restoreOwnerPhrase on the household agent
  const phrase = 'one two three four five six seven eight nine ten eleven twelve';
  expect(await surface.handle(phrase, 'rst')).toBe(true);
  const call = calls.find((c) => c.opId === 'restoreOwnerPhrase');
  expect(call.origin).toBe('household');
  expect(call.args.mnemonic).toBe(phrase);
  expect(replies.at(-1).kind).toBe('access-result');
  expect(replies.at(-1).text).toMatch(/hersteld|restored/i);      // success surfaced
});

test('access affordance — an invalid restore phrase is rejected without calling the host skill', async () => {
  const calls = [];
  const callSkill = async (origin, opId) => { calls.push(opId); return { ok: true }; };
  const replies = [];
  const surface = createFeedbackSurface({ config: cfg(), pod: new InMemoryCentralPod(), callSkill, accessButton: true, emit: (r) => replies.push(r) });
  await surface.start('inv'); replies.length = 0;
  await surface.handle('fp:access:restore', 'inv');
  expect(await surface.handle('too few words here', 'inv')).toBe(true);   // 4 words → invalid
  expect(calls.includes('restoreOwnerPhrase')).toBe(false);
  expect(replies.at(-1).text).toMatch(/12 of 24|12 or 24/);
});

test('parseFeedbackInvite reads a project-invite link', () => {
  expect(parseFeedbackInvite('https://app.example/?projectId=gemeente-x&code=abc123')).toEqual({ projectId: 'gemeente-x', code: 'abc123' });
  expect(parseFeedbackInvite('projectId=p&code=c')).toEqual({ projectId: 'p', code: 'c' });
  expect(parseFeedbackInvite('https://app.example/?foo=bar')).toBe(null);
  expect(parseFeedbackInvite('')).toBe(null);
});

test('feedback threads stay isolated', async () => {
  const { surface, pod } = setup();
  await surface.start('x'); await surface.start('y');
  for (const tid of ['x', 'y']) {
    await surface.handle('GGZ wachtlijst te lang', tid);
    await surface.handle('klaar', tid);
    await surface.handle('verstuur alles', tid);
  }
  expect(new Set(pod.list().map((c) => c.participant))).toEqual(new Set(['cc:x', 'cc:y']));
});

test('feedbackContactItem — distinct agent contact (id matches bot address, openFeedback action)', () => {
  const item = feedbackContactItem({ label: 'Feedback assistant', openLabel: 'Open chat' });
  expect(item.id).toBe('fp-bot');          // matches the co-hosted bot address
  expect(item.type).toBe('agent');
  expect(item.kind).toBe('agent');
  expect(item.icon).toBeTruthy();
  expect(item.label).toBe('Feedback assistant');
  expect(item.buttons).toEqual([{ label: 'Open chat', callbackData: 'openFeedback:fp-bot' }]);
});
