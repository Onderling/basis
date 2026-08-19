// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderCircleScreen } from '../../web/v2/circleScreen.js';

const t = (key, params) =>
  params && params.type ? `${key}:${params.type}` : key;

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const okAnnouncement = {
  blockId: 'b1', type: 'announcement', status: 'ok',
  content: { text: 'Street party zaterdag!' },
};
const okText = {
  blockId: 'b2', type: 'text', status: 'ok',
  content: { text: 'Wat info onder elkaar.' },
};
const okPhoto = {
  blockId: 'b3', type: 'photo', status: 'ok',
  content: { src: '/feest.jpg', caption: 'Vorig jaar' },
};
// Batch 4 — the renderer paints the STAMPED `senderLabel` (materializeNoticeboard resolves it from
// the roster through the reveal ladder); a payload-claimed name (`senderDisplay`/`authorName`) is
// exactly the leak the stamp replaced and must never paint.
const okNoticeboard = {
  blockId: 'b4', type: 'noticeboard', status: 'ok',
  content: { items: [
    { id: 'r1', actor: 'webid:anne', senderSelf: false, senderLabel: 'Anne', senderLabelKey: null,
      event: { payload: { text: 'Heeft iemand een ladder?', senderDisplay: 'Gejat Naampje' } } },
    { id: 'r2', actor: 'webid:pieter', senderSelf: false, senderLabel: 'Pieter', senderLabelKey: null,
      event: { payload: { text: 'Boekje te geef.', authorName: 'Pieter' } } },
  ] },
};
const okAgenda = {
  blockId: 'b5', type: 'agenda', status: 'ok',
  content: { items: [
    { id: 'e1', label: 'Circle drinks zaterdag 17u', type: 'calendar-event', state: 'open' },
    { id: 'e2', label: 'Plantjes ruilen zondag',   type: 'calendar-event', state: 'open' },
  ] },
};
const okRules = {
  blockId: 'b6', type: 'rules', status: 'ok',
  content: { doc: { purpose: 'Een fijne circle zijn', agreements: 'Geen herrie na 22u',
                    admins: '', conflict: '', admission: '', leaving: '', responsibility: '' } },
};

describe('renderCircleScreen · α.1c.1 — empty + container shape', () => {
  it('adds the .circle-screen class to the container', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [], t });
    expect(el.classList.contains('circle-screen')).toBe(true);
  });

  it('renders the empty-state when blocks is missing or empty', () => {
    const el1 = mount();
    renderCircleScreen(el1, { blocks: [], t });
    expect(el1.querySelector('.circle-screen__empty').textContent).toBe('circle.screen.empty');

    const el2 = mount();
    renderCircleScreen(el2, { t });
    expect(el2.querySelector('.circle-screen__empty')).not.toBeNull();
  });

  it('re-renders idempotently (no DOM accumulation on repeat calls)', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okText], t });
    expect(el.querySelectorAll('.circle-screen__block').length).toBe(1);
    renderCircleScreen(el, { blocks: [okText, okAnnouncement], t });
    expect(el.querySelectorAll('.circle-screen__block').length).toBe(2);
  });
});

describe('renderCircleScreen · α.1c.1 — block shapes', () => {
  it('announcement: writes the text in a serif paragraph card', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okAnnouncement], t });
    const block = el.querySelector('.circle-screen__block--announcement');
    expect(block).not.toBeNull();
    expect(block.dataset.blockId).toBe('b1');
    expect(block.dataset.status).toBe('ok');
    expect(block.querySelector('.circle-screen__announcement-text').textContent)
      .toBe('Street party zaterdag!');
  });

  it('text: writes a paragraph body', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okText], t });
    const body = el.querySelector('.circle-screen__text-body');
    expect(body.textContent).toBe('Wat info onder elkaar.');
  });

  it('photo: img with src + alt, optional caption when non-blank', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okPhoto], t });
    const img = el.querySelector('.circle-screen__photo');
    expect(img.getAttribute('src')).toBe('/feest.jpg');
    expect(img.getAttribute('alt')).toBe('Vorig jaar');
    expect(el.querySelector('.circle-screen__photo-caption').textContent).toBe('Vorig jaar');
  });

  it('photo: caption element omitted when caption is blank', () => {
    const el = mount();
    renderCircleScreen(el, {
      blocks: [{ blockId: 'p', type: 'photo', status: 'ok', content: { src: '/x.jpg', caption: '' } }],
      t,
    });
    expect(el.querySelector('.circle-screen__photo-caption')).toBeNull();
  });

  it('noticeboard: titled list with sender + text per row', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okNoticeboard], t });
    expect(el.querySelector('.circle-screen__block--noticeboard')).not.toBeNull();
    const rows = el.querySelectorAll('.circle-screen__noticeboard-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.rowId).toBe('r1');
    expect(rows[0].querySelector('.circle-screen__noticeboard-sender').textContent).toBe('Anne');
    expect(rows[0].querySelector('.circle-screen__noticeboard-text').textContent)
      .toBe('Heeft iemand een ladder?');
    expect(rows[1].querySelector('.circle-screen__noticeboard-sender').textContent).toBe('Pieter');
    // …and the payload-claimed name never paints (batch 4: the stamp is the only sender source).
    expect(el.textContent).not.toContain('Gejat Naampje');
  });

  it('noticeboard: an UNSTAMPED row paints no sender — never a wire-claimed name (batch 4)', () => {
    const el = mount();
    renderCircleScreen(el, {
      blocks: [{
        blockId: 'b4u', type: 'noticeboard', status: 'ok',
        content: { items: [
          { id: 'r1', actor: 'webid:anne',
            event: { payload: { text: 'Ladder?', senderDisplay: 'Wire Naam' } } },
        ] },
      }],
      t,
    });
    expect(el.querySelector('.circle-screen__noticeboard-sender')).toBeNull();
    expect(el.textContent).not.toContain('Wire Naam');
  });

  it('agenda: titled list with label per row', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okAgenda], t });
    const rows = el.querySelectorAll('.circle-screen__agenda-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.eventId).toBe('e1');
    expect(rows[0].querySelector('.circle-screen__agenda-label').textContent)
      .toBe('Circle drinks zaterdag 17u');
  });

  it('tasks (α.4): titled list of rows with circle tag + text', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [{
      blockId: 'b', type: 'tasks', status: 'ok',
      content: { items: [
        { id: 't1', text: 'Plant tomatoes', circleName: 'Selwerd', state: 'open' },
        { id: 't2', text: 'Borrow drill',   circleName: 'Helpman', state: 'claimed' },
      ] },
    }], t });
    expect(el.querySelector('.circle-screen__block--tasks')).not.toBeNull();
    const rows = el.querySelectorAll('.circle-screen__tasks-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.taskId).toBe('t1');
    expect(rows[0].dataset.state).toBe('open');
    expect(rows[0].querySelector('.circle-screen__tasks-circle').textContent).toBe('Selwerd');
    expect(rows[0].querySelector('.circle-screen__tasks-text').textContent).toBe('Plant tomatoes');
  });

  it('rules: emits a field block per non-blank field, suppresses empty fields', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okRules], t });
    const fields = el.querySelectorAll('.circle-screen__rules-field');
    expect(fields).toHaveLength(2);  // purpose + agreements only — others are empty
    expect(el.querySelector('.circle-screen__rules-field--purpose .circle-screen__rules-value').textContent)
      .toBe('Een fijne circle zijn');
    expect(el.querySelector('.circle-screen__rules-field--agreements .circle-screen__rules-value').textContent)
      .toBe('Geen herrie na 22u');
  });
});

describe('renderCircleScreen · α.5c — compact rows modifier', () => {
  function noticeboardBlock(config) {
    return {
      blockId: 'nb', type: 'noticeboard', status: 'ok',
      content: { items: [
        { id: 'r1', event: { payload: { text: 'hello', senderDisplay: 'Anne' } } },
      ] },
      ...(config !== undefined ? { config } : {}),
    };
  }

  it('compact:true on a noticeboard block adds the modifier class', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [noticeboardBlock({ compact: true })], t });
    const block = el.querySelector('.circle-screen__block--noticeboard');
    expect(block).not.toBeNull();
    expect(block.classList.contains('circle-screen__block--compact')).toBe(true);
  });

  it('compact:false or missing config does NOT add the modifier class', () => {
    const elA = mount();
    renderCircleScreen(elA, { blocks: [noticeboardBlock({ compact: false })], t });
    expect(elA.querySelector('.circle-screen__block--noticeboard').classList.contains('circle-screen__block--compact')).toBe(false);

    const elB = mount();
    renderCircleScreen(elB, { blocks: [noticeboardBlock()], t });
    expect(elB.querySelector('.circle-screen__block--noticeboard').classList.contains('circle-screen__block--compact')).toBe(false);
  });

  it('non-list-shaped types (text/photo/rules) never get the compact modifier even if compact:true is set', () => {
    const el = mount();
    renderCircleScreen(el, {
      blocks: [
        { blockId: 't', type: 'text',   status: 'ok', config: { compact: true }, content: { text: 'hi' } },
        { blockId: 'p', type: 'photo',  status: 'ok', config: { compact: true }, content: { src: '/x.jpg', caption: '' } },
        { blockId: 'r', type: 'rules',  status: 'ok', config: { compact: true }, content: { doc: { purpose: 'X', admins: '', agreements: '', conflict: '', admission: '', leaving: '', responsibility: '' } } },
      ],
      t,
    });
    for (const cls of ['--text', '--photo', '--rules']) {
      const block = el.querySelector(`.circle-screen__block${cls}`);
      expect(block).not.toBeNull();
      expect(block.classList.contains('circle-screen__block--compact')).toBe(false);
    }
  });
});

describe('renderCircleScreen · δ.1 — refreshing pip', () => {
  it('renders a .circle-screen__refreshing pip when refreshing:true on non-empty blocks', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okText], t, refreshing: true });
    const pip = el.querySelector('.circle-screen__refreshing');
    expect(pip).not.toBeNull();
    expect(pip.textContent).toBe('⟳');
    expect(pip.title).toBe('circle.screen.refreshing');
    expect(pip.getAttribute('aria-label')).toBe('circle.screen.refreshing');
  });

  it('omits the pip when refreshing is false (default)', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okText], t });
    expect(el.querySelector('.circle-screen__refreshing')).toBeNull();
  });

  it('omits the pip on the loading branch (blocks:null)', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: null, t, refreshing: true });
    expect(el.querySelector('.circle-screen__refreshing')).toBeNull();
    expect(el.querySelector('.circle-screen__loading')).not.toBeNull();
  });

  it('omits the pip on the empty branch (blocks:[])', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [], t, refreshing: true });
    expect(el.querySelector('.circle-screen__refreshing')).toBeNull();
    expect(el.querySelector('.circle-screen__empty')).not.toBeNull();
  });

  it('re-renders idempotently: pip disappears when refreshing flips false', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okText], t, refreshing: true });
    expect(el.querySelectorAll('.circle-screen__refreshing').length).toBe(1);
    renderCircleScreen(el, { blocks: [okText], t, refreshing: false });
    expect(el.querySelector('.circle-screen__refreshing')).toBeNull();
  });
});

describe('renderCircleScreen · α.1c.1 — status branches', () => {
  it('status:"empty" renders the per-block empty state', () => {
    const el = mount();
    renderCircleScreen(el, {
      blocks: [{ blockId: 'e', type: 'announcement', status: 'empty', content: { text: '' } }],
      t,
    });
    const block = el.querySelector('.circle-screen__block--announcement');
    expect(block.classList.contains('circle-screen__block--empty')).toBe(true);
    expect(block.textContent).toContain('circle.screen.block_empty');
  });

  it('status:"error" renders an error block with the error message', () => {
    const el = mount();
    renderCircleScreen(el, {
      blocks: [{ blockId: 'x', type: 'agenda', status: 'error', content: {}, error: 'calendar offline' }],
      t,
    });
    const block = el.querySelector('.circle-screen__block--agenda');
    expect(block.classList.contains('circle-screen__block--error')).toBe(true);
    expect(block.textContent).toContain('calendar offline');
  });

  it('mixed render: error/empty blocks DO NOT break later ok blocks', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [
      { blockId: 'err', type: 'agenda', status: 'error', content: {}, error: 'down' },
      okText,
      { blockId: 'emp', type: 'announcement', status: 'empty', content: { text: '' } },
      okAnnouncement,
    ], t });
    const ok = el.querySelectorAll('.circle-screen__block[data-status="ok"]');
    expect(ok).toHaveLength(2);
    const err = el.querySelectorAll('.circle-screen__block--error');
    expect(err).toHaveLength(1);
    const emp = el.querySelectorAll('.circle-screen__block--empty');
    expect(emp).toHaveLength(1);
  });
});

describe('renderCircleScreen · D1 (§5A) — quickActions pills', () => {
  const okQuick = {
    blockId: 'qa', type: 'quickActions', status: 'ok',
    content: { source: 'frequency', actions: [{ key: 'chat' }, { key: 'tasks' }, { key: 'houseRules' }] },
  };

  it('renders one pill per action with the feature label + data-action-key', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okQuick], t });
    const pills = el.querySelectorAll('.circle-screen__quick-action');
    expect(pills).toHaveLength(3);
    expect([...pills].map((p) => p.dataset.actionKey)).toEqual(['chat', 'tasks', 'houseRules']);
    // labels resolve via featureActionLabelKey → tab/settings locale keys.
    expect(pills[0].textContent).toBe('circle.tabs.gesprek');
    expect(pills[2].textContent).toBe('circle.settings.feat.houseRules');
  });

  it('fires onAction(key) on click', () => {
    const el = mount();
    const fired = [];
    renderCircleScreen(el, { blocks: [okQuick], t, onAction: (k) => fired.push(k) });
    el.querySelectorAll('.circle-screen__quick-action')[1].click();
    expect(fired).toEqual(['tasks']);
  });

  it('disables pills when no onAction is provided', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okQuick], t });
    const pills = el.querySelectorAll('.circle-screen__quick-action');
    expect([...pills].every((p) => p.disabled)).toBe(true);
  });
});
