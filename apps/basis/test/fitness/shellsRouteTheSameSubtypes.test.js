/**
 * FITNESS — both shells register the SAME inbound peer-message subtypes.
 *
 * The peer router is composed twice: web builds its handler map in `web/v2/circleApp.js`
 * (`makePeerRouter({ handlers: { … } })`), mobile in `basis-mobile/src/screens/ChatScreen.js`
 * (`buildPeerWiring`). On 2026-08-29 one of them was wrong in a way nothing caught: a stale closure
 * gave every rail a null and the mobile router was never attached at all. The phone could send and
 * could not receive, and the UI painted perfectly the whole time.
 *
 * A subtype one shell routes and the other does not is the same class of defect one step smaller: a
 * message kind that lands on web and vanishes on the phone. This guard fails on ANY difference —
 * either direction — except the ones listed below with a reason.
 *
 * Since 2026-09-09 most of the answer is structural rather than checked: the five signed lanes and the
 * personal ones are built ONCE in `src/v2/circleLanes.js` and spread into both compositions, so they
 * cannot drift apart at all. What remains hand-written in each shell is what only that shell can
 * answer — bubbles, wizard stashes, the nearby room, the threads it paints — and that remainder is what
 * the comparison below covers. The first test is therefore the load-bearing one: it checks that both
 * shells actually spread the shared table, because a shell that stopped would lose every lane at once
 * and every other assertion here would still pass.
 *
 * Reading source rather than running it is deliberate: `src/screens/**` has no runtime test coverage
 * (docs/agent-notes-known-gotchas.md), and the composition is the thing that drifted.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));

const WEB    = readFileSync(dir('../../web/v2/circleApp.js'), 'utf8');
const MOBILE = readFileSync(dir('../../../basis-mobile/src/screens/ChatScreen.js'), 'utf8');

/**
 * Subtypes one shell routes ON PURPOSE that the other does not. Every entry needs a reason, and an
 * entry whose reason has expired must be removed (the test fails on a listed subtype that both shells
 * now route). Adding here is a decision about parity, not a way to make the test green.
 */
const KNOWN_DIFFERENCES = {
  // Mobile-only, all four from the retired `tasks-mobile` salvage: the peer-intro handshake and the
  // `help-with-*` subtypes have no web sender or receiver at all (`circle-post` DID have a shared sender —
  // realAgent fans it on postRequest — and web now receives it too). Deleting them from
  // mobile is the parity move; until someone does, they are recorded here rather than hidden.
  'circle-peer-intro':    'mobile-only (tasks-mobile salvage; no web counterpart) — 2026-08-29',
  'help-with-accepted':   'mobile-only (tasks-mobile salvage; no web counterpart) — 2026-08-29',
  'help-with-response':   'mobile-only (tasks-mobile salvage; no web counterpart) — 2026-08-29',
};

/** The handler-map region of each composition: from the router/builder start to `defaultHandler`. */
function region(src, startRe, endRe) {
  const a = src.search(startRe);
  if (a < 0) return '';
  const rest = src.slice(a);
  const b = rest.search(endRe);
  return b < 0 ? rest : rest.slice(0, b);
}

/**
 * Every subtype a handler map routes. Three declaration shapes exist in both files:
 *   'circle-x-broadcast': handler          — a literal key
 *   [SOME_CONSTANT]: handler               — an imported constant (compared by name)
 *   [thing.subtypes.request]: handler      — a catch-up pair (compared by the trailing member)
 */
function subtypesOf(block) {
  const out = new Set();
  for (const m of block.matchAll(/'([a-z0-9][a-z0-9-]{3,})'\s*:/g)) out.add(m[1]);
  for (const m of block.matchAll(/\[([A-Z_][A-Z0-9_]{3,})\]\s*:/g)) out.add(m[1]);
  for (const m of block.matchAll(/\[[\w.]+\.subtypes\.(\w+)\]\s*:/g)) out.add(`catchup:${m[1]}`);
  return out;
}

const LANES = readFileSync(dir('../../src/v2/circleLanes.js'), 'utf8');

const webBlock    = region(WEB,    /const peerMessageRouter = makePeerRouter\(\{/, /\n\s*defaultHandler/);
const mobileBlock = region(MOBILE, /const buildPeerWiring = useCallback/,           /const defaultHandler/);

describe('FITNESS — both shells route the same peer-message subtypes', () => {
  it('finds both compositions', () => {
    expect(webBlock.length, 'web: makePeerRouter({ handlers }) block').toBeGreaterThan(200);
    expect(mobileBlock.length, 'mobile: buildPeerWiring handler block').toBeGreaterThan(200);
  });

  it('both shells spread the SHARED lane table — the one thing nothing after it could catch', () => {
    // A shell that stopped spreading this would lose every signed lane in a single edit, and the
    // comparison below would go on passing, because it compares the two remainders to each other.
    expect(webBlock,    'web no longer spreads the lane table').toMatch(/\.\.\.\w*[Ll]anes\.handlers/);
    expect(mobileBlock, 'mobile no longer spreads the lane table').toMatch(/\.\.\.\w*[Ll]anes\.handlers/);
    expect(WEB,    'web does not import buildCircleLanes').toContain('buildCircleLanes');
    expect(MOBILE, 'mobile does not import buildCircleLanes').toContain('buildCircleLanes');
  });

  const web = subtypesOf(webBlock);
  const mobile = subtypesOf(mobileBlock);

  it('routes on mobile everything web routes', () => {
    const missing = [...web].filter((s) => !mobile.has(s) && !KNOWN_DIFFERENCES[s]);
    expect(missing, 'subtypes web routes that mobile does NOT — a message kind that vanishes on the phone').toEqual([]);
  });

  it('routes on web everything mobile routes', () => {
    const missing = [...mobile].filter((s) => !web.has(s) && !KNOWN_DIFFERENCES[s]);
    expect(missing, 'subtypes mobile routes that web does NOT').toEqual([]);
  });

  it('keeps the known-differences list honest (an entry both shells now route must be removed)', () => {
    const stale = Object.keys(KNOWN_DIFFERENCES).filter((s) => web.has(s) && mobile.has(s));
    expect(stale, 'listed as a difference, but both shells route it now').toEqual([]);
    const phantom = Object.keys(KNOWN_DIFFERENCES).filter((s) => !web.has(s) && !mobile.has(s));
    expect(phantom, 'listed as a difference, but neither shell routes it').toEqual([]);
  });

  it('is comparing real sets, not empty ones', () => {
    // The shared table carries the lanes; each shell's own block carries its own answers. Both have to
    // be non-trivial, or this file is asserting nothing at all.
    // Counted by SHAPE, not by lane: the shared table writes the catch-up trio once and reuses it for
    // every lane, which is the deduplication that made it worth extracting. So name the lanes instead.
    const shared = subtypesOf(LANES);
    for (const lane of ['CHAT_STATEMENT_BROADCAST', 'KEY_STATEMENT_BROADCAST', 'TASK_BROADCAST',
                        'MEMBERSHIP_BROADCAST', 'GRANTS_BROADCAST']) {
      expect(shared.has(lane), `the shared lane table no longer routes ${lane}`).toBe(true);
    }
    expect([...shared].filter((x) => x.startsWith('catchup:')).length,
      'the shared table routes no catch-up at all — an offline device would never converge').toBeGreaterThan(1);
    expect(web.size,    'subtypes the web shell answers itself').toBeGreaterThan(8);
    expect(mobile.size, 'subtypes the mobile shell answers itself').toBeGreaterThan(8);
  });
});
