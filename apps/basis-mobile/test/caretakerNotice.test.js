/**
 * The mobile half of "a circle became yours".
 *
 * When the last admin walks out, the roster fold appoints a successor. That is DERIVED — every device
 * reaches it alone and offline, with nobody to ask — and so it happened in complete silence: nothing
 * recorded it, and the person it happened to had no way to learn it except by noticing that a button
 * they had never had suddenly worked. The circle screen is where mobile breaks that silence.
 *
 * Two halves, because the seam has two:
 *
 *   1. THE DECISION, driven over REAL folded rosters (signed statements → foldRoster) with exactly the
 *      inputs the screen passes it: the raw `listGroupMembers` rows and this device's own webid. Who
 *      is told and who is not is the part worth proving, and it is proven against the fold rather
 *      than against a hand-built shape.
 *   2. THE WIRING, as source text. `src/screens/**` is excluded from this suite (vitest cannot render
 *      RN), so nothing else stands between a deleted line and mobile silently going back to handing
 *      people circles without a word.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { foldRoster, signSpine, AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { normalizeCircleMembers } from '@onderling/kring-host/circleMembers';
import { caretakerNotice, CARETAKER_NOTICE_KEYS } from '../../basis/src/v2/caretakerNotice.js';

const SCREEN = readFileSync(
  fileURLToPath(new URL('../src/screens/v2/CircleLauncherScreen.js', import.meta.url)), 'utf8');

const CIRCLE = 'c';
const body = (id, kind, subject, { payload, parent = null, deps = [] } = {}) =>
  signSpine(id, { kind, circleId: CIRCLE, subject: subject.pubKey ?? subject, payload, parent, deps }).body;

/** Roster rows as `deriveRoster` stamps them — the shape `listGroupMembers` hands the screen. */
const rowsFrom = (folded) => {
  const admins = new Set(folded.admins);
  return folded.members.map((ref) => {
    const row = { webid: ref, role: admins.has(ref) ? 'admin' : 'member' };
    const via = folded.adminProvenance?.[ref];
    if (via) {
      row.adminVia = via;
      if (via.startsWith('caretaker:')
        && folded.caretakerAcknowledged?.[ref] === via.slice('caretaker:'.length)) {
        row.adminViaAcknowledged = true;
      }
    }
    return row;
  });
};

async function ids(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await AgentIdentity.generate(new VaultMemory()));
  return out;
}

/** founder + two members; the founder (the only admin) leaves, so the fold appoints one of the two. */
async function circleWithCaretaker() {
  const [founder, bob, cato] = await ids(3);
  const joinB = body(bob, 'join', bob);
  const joinM = body(cato, 'join', cato);
  const leave = body(founder, 'leave', founder, { deps: [joinB.hash, joinM.hash] });
  const stmts = [joinB, joinM, leave];
  const folded = foldRoster(stmts, { founders: [founder.pubKey] });
  const caretakerRef = folded.admins[0];
  const caretaker = [bob, cato].find((p) => p.pubKey === caretakerRef);
  const other = [bob, cato].find((p) => p.pubKey !== caretakerRef);
  const joinOf = { [bob.pubKey]: joinB, [cato.pubKey]: joinM };
  return { founder, stmts, folded, caretaker, caretakerRef, other, leave, joinOf };
}

/**
 * What the screen does with the roster it just loaded, spelled out once: ask the shared decision, and
 * if it answers, append ONE local bot bubble carrying ONE act. The wiring half below holds the screen
 * to each line of this.
 */
function openCircleWith({ members, myRef }) {
  const posted = [];
  const notice = caretakerNotice({ members, myRef });
  if (notice) {
    posted.push({
      actor: 'bot',
      textKey: notice.key,
      buttons: [{ id: 'caretaker:acknowledge', labelKey: 'circle.caretaker.acknowledge' }],
      scope: 'self',
    });
  }
  return posted;
}

describe('mobile — the circle screen tells the person it became theirs', () => {
  it('the appointed person gets one bubble, addressed only to them, carrying one act', async () => {
    const { folded, caretakerRef } = await circleWithCaretaker();
    const posted = openCircleWith({ members: rowsFrom(folded), myRef: caretakerRef });

    expect(posted).toHaveLength(1);
    expect(posted[0].textKey).toBe(CARETAKER_NOTICE_KEYS.mine);
    expect(posted[0].scope, 'fanning it would announce the handover to the circle').toBe('self');
    expect(posted[0].buttons).toHaveLength(1);
  });

  it('nobody else in the circle is told — the member list is where they read it', async () => {
    const { folded, other, founder } = await circleWithCaretaker();
    const rows = rowsFrom(folded);
    expect(openCircleWith({ members: rows, myRef: other.pubKey })).toEqual([]);
    expect(openCircleWith({ members: rows, myRef: founder.pubKey })).toEqual([]);
  });

  it('once they have SIGNED for it the screen stays quiet, on every one of their devices', async () => {
    const { stmts, founder, caretaker, caretakerRef, leave, joinOf } = await circleWithCaretaker();
    const signed = body(caretaker, 'role', caretakerRef, {
      payload: { role: 'admin', caretakerFor: leave.hash },
      parent: joinOf[caretakerRef].hash, deps: [leave.hash],
    });
    const folded = foldRoster([...stmts, signed], { founders: [founder.pubKey] });
    // The log is the memory, not device-local bookkeeping — so this survives a reinstall.
    expect(folded.caretakerAcknowledged[caretakerRef]).toBe(leave.hash);
    expect(openCircleWith({ members: rowsFrom(folded), myRef: caretakerRef })).toEqual([]);
  });

  it('an ordinary admin — founder or promoted — is never told anything', async () => {
    const [founder, bob] = await ids(2);
    const join = body(bob, 'join', bob);
    const plain = foldRoster([join], { founders: [founder.pubKey] });
    expect(openCircleWith({ members: rowsFrom(plain), myRef: founder.pubKey })).toEqual([]);
    expect(openCircleWith({ members: rowsFrom(plain), myRef: bob.pubKey })).toEqual([]);

    const promote = body(founder, 'role', bob, { payload: { role: 'admin' }, deps: [join.hash] });
    const promoted = foldRoster([join, promote], { founders: [founder.pubKey] });
    expect(openCircleWith({ members: rowsFrom(promoted), myRef: bob.pubKey })).toEqual([]);
  });

  it('the MEMBERS-tab projection cannot answer this — which is why the screen keeps the raw rows', async () => {
    // `normalizeCircleMembers` renames `webid` to `id` and drops `adminViaAcknowledged`. Handing it
    // over throws nothing and warns nowhere; the notice just never fires again.
    const { folded, caretakerRef } = await circleWithCaretaker();
    const projected = normalizeCircleMembers({ members: rowsFrom(folded) });
    expect(projected.some((m) => m.id === caretakerRef)).toBe(true);
    expect(openCircleWith({ members: projected, myRef: caretakerRef })).toEqual([]);
  });
});

describe('mobile — the screen is wired to all of that (source guard: RN cannot render here)', () => {
  it('keeps the raw listGroupMembers rows beside the projected ones', () => {
    expect(SCREEN).toMatch(/setRosterRows\(raw\)/);
    expect(/caretakerNotice\(\{\s*members:\s*rosterRows\b/.test(SCREEN),
      'the screen feeds the notice something other than the raw roster rows').toBe(true);
  });

  it('posts it as a local bot bubble through the shell\'s own primitive', () => {
    const site = SCREEN.slice(SCREEN.indexOf('caretakerNotice({'));
    const bubble = site.slice(0, 500);
    expect(bubble).toMatch(/appendCircleMessage\(\{/);
    expect(bubble).toMatch(/actor:\s*'bot'/);
    expect(bubble).toMatch(/scope:\s*'self'/);
    expect(bubble, 'the notice text must go through t() (invariant 8)').toMatch(/t\(notice\.key\)/);
    expect(bubble).toMatch(/id:\s*'caretaker:acknowledge'/);
    expect(bubble).toMatch(/t\('circle\.caretaker\.acknowledge'\)/);
  });

  it('does NOT sign while drawing the screen', () => {
    // "Acknowledged" has to mean the person saw it. A render that signed would make it mean
    // "a screen appeared", and the circle would learn nothing from the record.
    const site = SCREEN.slice(SCREEN.indexOf('caretakerNotice({'), SCREEN.indexOf('caretakerNotice({') + 600);
    expect(site).not.toMatch(/acknowledgeCaretaker'/);
  });

  it('a TAP on the button calls the op, scoped to this circle, and re-reads the roster', () => {
    const router = SCREEN.slice(SCREEN.indexOf("'caretaker:acknowledge') {"));
    expect(router.slice(0, 120)).toMatch(/acknowledgeCaretakerNotice\(\)/);

    const handler = SCREEN.slice(SCREEN.indexOf('const acknowledgeCaretakerNotice'));
    expect(handler.slice(0, 500)).toMatch(
      /rawCallSkill\('stoop',\s*'acknowledgeCaretaker',\s*\{\s*groupId:\s*circle\.id\s*\}\)/);
    // …and the roster reload is what makes the member list say the appointment is acknowledged.
    expect(handler.slice(0, 500)).toMatch(/setMembersReloadTick/);
  });
});
