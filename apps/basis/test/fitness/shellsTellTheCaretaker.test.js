/**
 * FITNESS — BOTH shells tell the person a circle became theirs, and neither signs for them
 * (invariants 1 + 2 + 8).
 *
 * When the last admin walks out, the roster fold appoints a successor. That appointment is DERIVED,
 * so every device reaches it alone and offline with nobody to ask — and being derived, it happened in
 * complete silence: nothing recorded it, and the person it happened to had no way to learn it except
 * by noticing that a button they had never had suddenly worked. The decision about what to say lives
 * once, in `caretakerNotice`; what each shell owns is putting the line in front of the person and
 * carrying the act they sign with.
 *
 * Two failures are guarded here, and both are silent:
 *
 *   1. ONE SHELL WIRES IT. The other keeps handing people circles without a word — and looks fine,
 *      because nothing fails when nobody is told.
 *   2. THE ROWS ARE THE WRONG ONES. `normalizeCircleMembers` is the member-LIST projection: it renames
 *      `webid` to `id` and drops `adminViaAcknowledged` entirely. Feeding its output to the notice
 *      does not throw, does not warn, and never fires — the shell looks wired and says nothing. The
 *      behaviour test below drives that trap over a real fold so the guard is not just a spelling
 *      check.
 *
 * The decision's own behaviour is proven against real folded rosters in `test/v2/caretakerNotice.test.js`
 * and the op in stoop's suite. What CANNOT be covered there is whether a shell bothered to call either:
 * `circleApp.js` boots at import and `src/screens/**` has no runtime coverage at all, so for the wiring
 * these are source-text guards — the same trade `shellsShowAdminProvenance` makes next door.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { foldRoster, signSpine, AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { normalizeCircleMembers } from '@onderling/kring-host/circleMembers';
import { caretakerNotice, CARETAKER_NOTICE_KEYS } from '../../src/v2/caretakerNotice.js';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(dir(p), 'utf8');

const WEB    = read('../../web/v2/circleApp.js');
const MOBILE = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');
const SHELLS = [['web (circleApp.js)', WEB], ['mobile (CircleLauncherScreen.js)', MOBILE]];

const localeText = (lang, key) => {
  const tree = JSON.parse(read(`../../src/locales/circle.${lang}.json`));
  let node = tree;
  for (const seg of key.replace(/^circle\./, '').split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[seg];
  }
  return node && typeof node === 'object' ? node.text : undefined;
};

// ── a real circle whose last admin left ────────────────────────────────────────────────────────────
const CIRCLE = 'c';
const body = (id, kind, subject, { payload, parent = null, deps = [] } = {}) =>
  signSpine(id, { kind, circleId: CIRCLE, subject: subject.pubKey ?? subject, payload, parent, deps }).body;

/** Roster rows as `deriveRoster` stamps them — the shape `listGroupMembers` hands a shell. */
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
 * The bubble a shell builds from the notice. Written out here because BOTH shells build exactly this
 * and the tests below hold each of them to it line by line — pin the agreement, not either copy.
 */
const bubbleFor = (notice, lang) => (notice ? {
  text: localeText(lang, notice.key),
  buttons: [{ id: 'caretaker:acknowledge', label: localeText(lang, 'circle.caretaker.acknowledge') }],
} : null);

describe('the notice a shell has to paint, over real folded rosters', () => {
  it('the appointed person gets a line with one act on it, in words a person can read', async () => {
    const { folded, caretakerRef } = await circleWithCaretaker();
    const notice = caretakerNotice({ members: rowsFrom(folded), myRef: caretakerRef });

    expect(notice).toMatchObject({ key: CARETAKER_NOTICE_KEYS.mine, acknowledge: true });
    for (const lang of ['en', 'nl']) {
      const bubble = bubbleFor(notice, lang);
      // Not a raw key on someone's screen, and not an empty button.
      expect(bubble.text, `${lang}: ${notice.key} has no text`).toBeTypeOf('string');
      expect(bubble.text).not.toMatch(/^circle\./);
      expect(bubble.buttons[0].label, `${lang}: the acknowledge label has no text`).toBeTypeOf('string');
    }
  });

  it('says nothing to anyone else in the circle — they read it off the member list', async () => {
    const { folded, other, founder } = await circleWithCaretaker();
    const rows = rowsFrom(folded);
    expect(caretakerNotice({ members: rows, myRef: other.pubKey })).toBeNull();
    expect(caretakerNotice({ members: rows, myRef: founder.pubKey })).toBeNull();
  });

  it('stops once they have SIGNED for it — a shell that re-opens the circle stays quiet', async () => {
    const { stmts, founder, caretaker, caretakerRef, leave, joinOf } = await circleWithCaretaker();
    const signed = body(caretaker, 'role', caretakerRef, {
      payload: { role: 'admin', caretakerFor: leave.hash },
      parent: joinOf[caretakerRef].hash, deps: [leave.hash],
    });
    const folded = foldRoster([...stmts, signed], { founders: [founder.pubKey] });
    expect(folded.caretakerAcknowledged[caretakerRef]).toBe(leave.hash);
    expect(caretakerNotice({ members: rowsFrom(folded), myRef: caretakerRef })).toBeNull();
  });

  it('says nothing where the admin is an ordinary one — founder or promoted', async () => {
    const [founder, bob] = await ids(2);
    const join = body(bob, 'join', bob);
    const plain = foldRoster([join], { founders: [founder.pubKey] });
    expect(caretakerNotice({ members: rowsFrom(plain), myRef: founder.pubKey })).toBeNull();
    expect(caretakerNotice({ members: rowsFrom(plain), myRef: bob.pubKey })).toBeNull();

    const promote = body(founder, 'role', bob, { payload: { role: 'admin' }, deps: [join.hash] });
    const promoted = foldRoster([join, promote], { founders: [founder.pubKey] });
    expect(caretakerNotice({ members: rowsFrom(promoted), myRef: bob.pubKey })).toBeNull();
  });

  it('THE TRAP: the member-list projection cannot answer this, and fails silently if handed over', async () => {
    // `normalizeCircleMembers` is what both shells paint the MEMBERS tab from. It renames `webid` to
    // `id` and drops `adminViaAcknowledged`, so a shell that reached for the roster it already had
    // would wire the whole chain and never say a word. This is why both shells keep the raw rows.
    const { folded, caretakerRef } = await circleWithCaretaker();
    const projected = normalizeCircleMembers({ members: rowsFrom(folded) });
    expect(projected.some((m) => m.id === caretakerRef)).toBe(true);          // the row is there…
    expect(caretakerNotice({ members: projected, myRef: caretakerRef })).toBeNull();   // …and mute.
  });
});

describe('FITNESS — both shells put the notice in front of the person', () => {
  for (const [name, source] of SHELLS) {
    it(`${name} asks the shared decision, never its own reading of the roster`, () => {
      expect(source.includes('caretakerNotice('),
        `${name} never asks whether this circle just became someone's`).toBe(true);
      expect(source.includes('/caretakerNotice.js'),
        `${name} does not import the shared decision (invariant 1)`).toBe(true);
    });

    it(`${name} hands it the RAW roster rows, not the member-list projection`, () => {
      // The trap proven above: `normalizeCircleMembers`' rows carry neither `webid` nor the
      // acknowledgement flag, so the notice would go permanently quiet with nothing failing.
      const call = source.slice(source.indexOf('caretakerNotice({'));
      expect(call.slice(0, 200)).not.toMatch(/normalizeCircleMembers/);
      expect(/caretakerNotice\(\{\s*members:\s*(rawRoster|rosterRows)\b/.test(source),
        `${name} feeds the notice something other than the raw listGroupMembers rows`).toBe(true);
    });

    it(`${name} paints it through t(), and carries the acknowledge button`, () => {
      expect(/\bt\(\s*notice\.key\s*\)/.test(source),
        `${name} does not resolve the notice text through t() (invariant 8)`).toBe(true);
      expect(source.includes("t('circle.caretaker.acknowledge')"),
        `${name} labels the act with a baked string instead of a locale key (invariant 8)`).toBe(true);
      expect(source.includes("'caretaker:acknowledge'"),
        `${name} shows the notice with no way to sign for it`).toBe(true);
      // Addressed to ONE person: fanning it would announce the handover to the whole circle.
      const bubble = source.slice(source.indexOf('caretakerNotice({'), source.indexOf('caretakerNotice({') + 600);
      expect(bubble, `${name} fans the notice to the circle`).toMatch(/scope:\s*'self'/);
    });

    it(`${name} signs only on a TAP — never on render`, () => {
      // The whole value of the signature is that "acknowledged" means the person SAW it. A device
      // that signed while drawing a screen would make it mean "a screen appeared".
      const ackAt = source.indexOf("'acknowledgeCaretaker'");
      expect(ackAt, `${name} never calls the op the button exists for`).toBeGreaterThan(-1);
      // The op is called from the button's own handler, and the notice-posting site does not reach it.
      const noticeSite = source.slice(source.indexOf('caretakerNotice({'), source.indexOf('caretakerNotice({') + 600);
      expect(noticeSite).not.toMatch(/acknowledgeCaretaker'/);
      expect(source.includes("acknowledgeCaretaker', { groupId:"),
        `${name} does not pass the circle to the op`).toBe(true);
    });

    it(`${name} routes the tapped button to that handler`, () => {
      const router = source.slice(source.indexOf("'caretaker:acknowledge') {"));
      expect(router.slice(0, 120)).toMatch(/acknowledgeCaretakerNotice\(\)/);
    });
  }

  it('the two shells agree on the button id — one id, or the tap reaches nothing', () => {
    const idOf = (src) => (src.match(/'caretaker:[a-z-]+'/g) ?? [])[0];
    expect(idOf(WEB)).toBe("'caretaker:acknowledge'");
    expect(idOf(MOBILE)).toBe(idOf(WEB));
  });

  it('the op the shells call is a real declared op that takes the circle', () => {
    // A shell calling an op that does not exist fails at the moment someone taps, months later.
    const manifest = read('../../../stoop/manifest.js');
    const at = manifest.indexOf("id:   'acknowledgeCaretaker'");
    expect(at, 'stoop no longer declares acknowledgeCaretaker').toBeGreaterThan(-1);
    expect(manifest.slice(at, at + 1600)).toMatch(/name:\s*'groupId'[^\n]*required:\s*true/);
  });
});
