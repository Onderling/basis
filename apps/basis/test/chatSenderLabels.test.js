/**
 * Batch 4 (the honesty batch) — sender labels come from the ROSTER through the reveal ladder,
 * never off the payload. @vitest-environment happy-dom
 *
 * The old shape: four `pickSender` copies reading `senderDisplay`/`authorName`/`displayName` off the
 * wire — whatever the sender claimed, including an unrevealed member's real name (the leak) or a
 * forged one (the enforceability failure). Now `chatRows` stamps `senderLabel`/`senderLabelKey` via
 * `revealedMemberLabel`, and the renderers only paint.
 */
import { describe, it, expect } from 'vitest';
import { chatRows, stampSenderLabels } from '../src/v2/circleStream.js';
import { materializeBlock } from '../src/v2/circleRecipeBlocks.js';
import { renderCircleView } from '../web/v2/circleView.js';

const t = (k) => k;

// `realName` is RELEASE-sourced (`released` states the member's own per-circle disclosure);
// a name someone holds locally but never released rides only `ownDisplayName` and shows nobody.
const MEMBERS = [
  { id: 'webid:ella',  webid: 'webid:ella',  handle: 'ella', realName: null, released: false,
    ownDisplayName: 'Ella Prins' },
  { id: 'webid:bram',  webid: 'webid:bram',  handle: null,   realName: 'Bram de Wit', released: true },
  { id: 'webid:me',    webid: 'webid:me',    handle: 'ik',   realName: null, released: false,
    ownDisplayName: 'Me Myself' },
  { id: 'webid:noor',  webid: 'webid:noor',  handle: null,   realName: null, released: false,
    ownDisplayName: 'Noor Visser', circleAddress: 'relay:noor.c1' },
];

const chatEvent = (actor, text, extraPayload = {}) => ({
  id: `e-${actor}-${text}`, ts: 1000, type: 'chat-message', actor,
  circleId: 'c1', payload: { circleId: 'c1', text, ...extraPayload },
});

const rowsFor = (events) => chatRows({
  events, circles: [{ id: 'c1', name: 'Buren' }], circleId: 'c1',
  members: MEMBERS, viewerId: 'webid:me', policy: 'pairwise',
});

describe('chatRows — the sender stamp', () => {
  it('a member with a handle gets @handle (pairwise, unrevealed: never the real name)', () => {
    const [row] = rowsFor([chatEvent('webid:ella', 'hoi')]);
    expect(row.senderLabel).toBe('@ella');
    expect(row.senderLabelKey).toBeNull();
    expect(row.senderSelf).toBe(false);
  });

  it('a member who RELEASED their name to this circle shows it (no handle to prefer)', () => {
    const [row] = rowsFor([chatEvent('webid:bram', 'dag')]);
    expect(row.senderLabel).toBe('Bram de Wit');
  });

  it('an unreleased member without a handle falls back to the id — never a cached name', () => {
    const [row] = rowsFor([chatEvent('webid:noor', 'hee')]);
    expect(row.senderLabel).toBe('webid:noor');
    expect(row.senderLabel).not.toContain('Noor');
  });

  it('matches on circleAddress too (an actor that never resolved past the transport address)', () => {
    const [row] = rowsFor([chatEvent('relay:noor.c1', 'hee')]);
    expect(row.senderLabel).toBe('webid:noor');
  });

  it('my own row is senderSelf with no label (a label on my bubble is noise)', () => {
    const [row] = rowsFor([chatEvent('webid:me', 'zelf')]);
    expect(row.senderSelf).toBe(true);
    expect(row.senderLabel).toBeNull();
    expect(row.senderLabelKey).toBeNull();
  });

  it('not-on-roster (departed or never resolved) gets the neutral KEY, not a blank, not the payload name', () => {
    const [row] = rowsFor([chatEvent('webid:vertrokken', 'oud', { senderDisplay: 'Gejat Naampje' })]);
    expect(row.senderLabel).toBeNull();
    expect(row.senderLabelKey).toBe('circle.chat.unknown_sender');
  });

  it('CONSERVATION: no roster passed → rows are exactly the pre-existing shape (no stamp fields)', () => {
    const [row] = chatRows({
      events: [chatEvent('webid:ella', 'hoi')],
      circles: [{ id: 'c1' }], circleId: 'c1',
    });
    expect('senderLabel' in row).toBe(false);
    expect('senderSelf' in row).toBe(false);
  });

  it('open policy widens who sees a RELEASE — it never conjures a name nobody disclosed', () => {
    const rows = stampSenderLabels(
      [{ actor: 'webid:noor' }, { actor: 'webid:bram' }],
      { members: MEMBERS, viewerId: 'webid:me', policy: 'open' },
    );
    expect(rows[0].senderLabel).toBe('webid:noor');   // released nothing → the honest id, even open
    expect(rows[1].senderLabel).toBe('Bram de Wit');  // released → open shows it
  });
});

describe('renderCircleView — the paint half', () => {
  const paint = (row) => renderCircleView(document.createElement('div'), {
    circle: { id: 'c1', name: 'Buren' }, t, activeTab: 'gesprek', rows: [row],
  });

  it('paints the stamped label, ignoring any payload-claimed name', () => {
    const [row] = rowsFor([chatEvent('webid:ella', 'hoi', { senderDisplay: 'Aangeklede Leugen' })]);
    const el = paint(row);
    expect(el.querySelector('.circle-circle__bubble-sender')?.textContent).toBe('@ella');
    expect(el.textContent).not.toContain('Aangeklede Leugen');
  });

  it('paints the neutral key for a stamped-unknown sender', () => {
    const [row] = rowsFor([chatEvent('webid:vertrokken', 'oud')]);
    const el = paint(row);
    expect(el.querySelector('.circle-circle__bubble-sender')?.textContent)
      .toBe('circle.chat.unknown_sender');
  });

  it('an UNSTAMPED row (roster still loading) paints no label — never a wire name', () => {
    const el = paint({
      id: 'e1', ts: 1000, type: 'chat-message', actor: 'webid:ella', circleId: 'c1',
      event: { type: 'chat-message', actor: 'webid:ella',
        payload: { circleId: 'c1', text: 'hoi', senderDisplay: 'Wire Naam' } },
    });
    expect(el.querySelector('.circle-circle__bubble-sender')).toBeNull();
    expect(el.textContent).not.toContain('Wire Naam');
  });
});

describe('materializeNoticeboard — the scherm shares the stamp', () => {
  it('stamps senderLabel from the roster; the full addedBy webid is the match key', async () => {
    const callSkill = async (app, op) => (op === 'listOpen'
      ? { items: [{ id: 'p1', type: 'request', intent: 'ask', text: 'wie helpt?', addedBy: 'webid:ella' }] }
      : {});
    const block = await materializeBlock({
      block: { id: 'b1', type: 'noticeboard', config: {} },
      circleId: 'c1',
      hostOps: { callSkill, members: MEMBERS, viewerId: 'webid:me', revealPolicy: 'pairwise' },
    });
    const [item] = block.content.items;
    expect(item.actor).toBe('webid:ella');
    expect(item.senderLabel).toBe('@ella');
  });
});
