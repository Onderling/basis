/**
 * What a circle's conversation shows.
 *
 * The decision: admin decides, default permissive, seeded from the circle template. What these pin is the
 * precedence chain and — the part most likely to rot — that the defaults stay DERIVED from the kind
 * registry rather than copied out of it.
 */
import { describe, it, expect } from 'vitest';
import { ENTRY_KINDS, LANE } from '@onderling/item-store';
import { CIRCLE_KINDS, applyTemplate, markAxisTouched } from '../../src/v2/circleTemplates.js';
import {
  defaultConversationKinds, availableConversationKinds, TEMPLATE_CONVERSATION_KINDS,
  resolveConversationKinds, setConversationKind, withDerivedChatFeature, chatIsInConversation,
  conversationKindsRows,
} from '../../src/v2/conversationKinds.js';

describe('the defaults are derived, not copied', () => {
  it('the permissive default is exactly the human lane', () => {
    // Copying the list would mean a human kind added to the registry later is silently missing from every
    // conversation — the drift the one-registry work exists to prevent.
    const human = Object.entries(ENTRY_KINDS).filter(([, s]) => s.lane === LANE.HUMAN).map(([k]) => k);
    expect(defaultConversationKinds().sort()).toEqual(human.sort());
  });

  it('technical kinds are off by default, and offerings are on', () => {
    const def = defaultConversationKinds();
    expect(def).toContain('aanbod');            // Frits said "maybe"; the per-circle setting resolves it
    expect(def).not.toContain('roster-updated');
    expect(def).not.toContain('agent-action');
  });

  it('the admin can choose from EVERY registered kind, not just the human ones', () => {
    // "technical stuff should be off ofcourse (but an admin should be able to decide otherwise)".
    const available = availableConversationKinds();
    expect(available).toHaveLength(Object.keys(ENTRY_KINDS).length);
    expect(available.find((a) => a.kind === 'governance')).toMatchObject({ defaultOn: false });
    expect(available.find((a) => a.kind === 'chat-message')).toMatchObject({ defaultOn: true });
  });
});

describe('the template axis', () => {
  it('names only REAL circle kinds', () => {
    // Guards against the failure that happened while writing this: inventing a template kind that the
    // wizard has never heard of, which would silently never apply.
    expect(Object.keys(TEMPLATE_CONVERSATION_KINDS).filter((k) => !CIRCLE_KINDS.includes(k))).toEqual([]);
  });

  it('a buurt shows the noticeboard, NOT open chat — matching its own template', () => {
    // `features.chat: false` for a buurt. A conversation full of chat messages would contradict the
    // template that created the circle.
    const kinds = resolveConversationKinds({ templateKind: 'buurt' });
    expect(kinds).not.toContain('chat-message');
    expect(kinds).toEqual(expect.arrayContaining(['vraag', 'aanbod']));
  });

  it('a household shows everything', () => {
    expect(resolveConversationKinds({ templateKind: 'household' })).toContain('chat-message');
  });

  it('an unknown kind falls to the permissive default rather than showing nothing', () => {
    expect(resolveConversationKinds({ templateKind: 'nope' })).toEqual(defaultConversationKinds());
    expect(resolveConversationKinds()).toEqual(defaultConversationKinds());
  });
});

describe('precedence: circle → template → default', () => {
  it("the admin's choice beats the template", () => {
    const kinds = resolveConversationKinds({ circleSetting: ['chat-message'], templateKind: 'buurt' });
    expect(kinds).toEqual(['chat-message']);
  });

  it('an EMPTY admin choice is respected — a circle may show nothing', () => {
    // `[]` is a decision; only `null`/absent means "not chosen".
    expect(resolveConversationKinds({ circleSetting: [], templateKind: 'household' })).toEqual([]);
  });

  it('unregistered kinds are dropped from a stored setting', () => {
    expect(resolveConversationKinds({ circleSetting: ['chat-message', 'not-a-kind', 'chat-message'] }))
      .toEqual(['chat-message']);
  });
});

describe('toggling one kind', () => {
  it('adds and removes', () => {
    const start = resolveConversationKinds({ templateKind: 'buurt' });
    const withChat = setConversationKind(start, 'chat-message', true);
    expect(withChat).toContain('chat-message');
    expect(setConversationKind(withChat, 'chat-message', false)).not.toContain('chat-message');
  });

  it('an admin may turn a TECHNICAL kind on', () => {
    expect(setConversationKind(['chat-message'], 'governance', true)).toContain('governance');
  });

  it('an unknown kind is ignored — a typo is not a new feature', () => {
    expect(setConversationKind(['chat-message'], 'invented', true)).toEqual(['chat-message']);
  });

  it('takes the RESOLVED list, so the first change starts from what was shown', () => {
    // Otherwise turning one kind off silently adopts the whole default set as an explicit choice, freezing
    // the circle against future registry changes.
    const resolved = resolveConversationKinds({ templateKind: 'household' });
    const after = setConversationKind(resolved, 'leen', false);
    expect(after).toContain('chat-message');
    expect(after).not.toContain('leen');
  });
});

describe('the wizard axis (J-CW1/J-CW2)', () => {
  it('a fresh template pre-fills the axis', () => {
    expect(applyTemplate({}, 'buurt').conversationKinds).toEqual(['vraag', 'aanbod', 'task', 'leen']);
    expect(applyTemplate({}, 'household').conversationKinds).toBeNull();   // null = the living default
  });

  it('J-CW1: an explicit choice SURVIVES a kind switch', () => {
    // The menukaart rule: presets pre-fill, the user wins per key. A template switch overwriting a
    // deliberate choice is the failure that makes people distrust every default in the wizard.
    // Since decision 4 (2026-07-29) "the user chose it" is recorded rather than inferred from the value
    // being set — setting the field alone no longer claims a person did it.
    let st = applyTemplate({}, 'buurt');
    st = applyTemplate(markAxisTouched({ ...st, conversationKinds: ['chat-message'] }, 'conversationKinds'), 'friends');
    expect(st.conversationKinds).toEqual(['chat-message']);
  });

  it('an untouched axis DOES follow the new kind — which it now genuinely does', () => {
    // This test's NAME and its body used to disagree: it asserted that household's `null` survived a
    // switch to buurt, i.e. that the axis did NOT follow. That was the old no-op semantics, and the
    // mismatch between the two was the smell. Under provenance the name is true.
    let st = applyTemplate({}, 'household');       // null (the living default)
    st = applyTemplate(st, 'buurt');
    expect(st.conversationKinds).toEqual(['vraag', 'aanbod', 'task', 'leen']);
  });
});


describe('features.chat is a VIEW of the kinds list (decision 3, 2026-07-29)', () => {
  it('a buurt reports no chat, whatever the stored flag says', () => {
    const p = withDerivedChatFeature({ kind: 'buurt', features: { chat: true, tasks: true } });
    expect(p.features.chat).toBe(false);
    expect(p.features.tasks).toBe(true);        // only the one derived key is touched
  });

  it('an explicit list beats the template', () => {
    const p = withDerivedChatFeature({ kind: 'buurt', conversationKinds: ['chat-message', 'vraag'], features: {} });
    expect(p.features.chat).toBe(true);
  });

  it('a circle with neither field resolves to the permissive default, stored flag or not', () => {
    // No backwards-compatibility requirement (Frits, 2026-07-29), so there is no pre-decision circle
    // whose stored flag must be honoured — the list is simply the answer, and an absent list means the
    // default one. Both directions, so the flag is demonstrably not consulted.
    expect(withDerivedChatFeature({ features: { chat: false } }).features.chat).toBe(true);
    expect(withDerivedChatFeature({ features: { chat: true } }).features.chat).toBe(true);
  });

  it('chatIsInConversation agrees with what the conversation will render', () => {
    for (const kind of ['buurt', 'household', 'friends', 'team']) {
      const kinds = resolveConversationKinds({ templateKind: kind });
      expect(chatIsInConversation({ templateKind: kind })).toBe(kinds.includes('chat-message'));
    }
  });
});

describe('conversationKindsRows — the admin control’s model (decision 3’s missing surface)', () => {
  it('offers every HUMAN kind, on or off, so an admin sees what a conversation could contain', () => {
    const rows = conversationKindsRows({ templateKind: 'buurt' });
    expect(rows.map((r) => r.kind).sort()).toEqual(['aanbod', 'chat-message', 'leen', 'task', 'vraag'].sort());
    expect(rows.find((r) => r.kind === 'chat-message').on).toBe(false);   // a buurt starts without chat
    expect(rows.find((r) => r.kind === 'vraag').on).toBe(true);
  });

  it('offers NO governance kind — the projection enforces the lane, so a checkbox would do nothing', () => {
    // Worse than useless: it would invite an admin to try putting decisions in the conversation, which
    // J-L1 exists to prevent. `availableConversationKinds()` returns those kinds; this control filters.
    const kinds = conversationKindsRows({ templateKind: 'household' }).map((r) => r.kind);
    expect(kinds).not.toContain('governance');
    for (const k of kinds) expect(ENTRY_KINDS[k].lane).toBe(LANE.HUMAN);
  });

  it('each row carries the WHOLE next list, so a shell persists what it displayed', () => {
    const rows = conversationKindsRows({ templateKind: 'buurt' });
    const chat = rows.find((r) => r.kind === 'chat-message');
    expect(chat.next).toContain('chat-message');                 // tapping an off row turns it on
    const vraag = rows.find((r) => r.kind === 'vraag');
    expect(vraag.next).not.toContain('vraag');                   // tapping an on row turns it off
    // …and the rest of the list is untouched either way.
    expect(vraag.next).toContain('aanbod');
  });

  it('an admin MAY empty the conversation — unlike a reader, who cannot empty their own filter', () => {
    // The admin decides what the circle IS; the reader decides what they look at. `chatFilterChips`
    // refuses to produce an empty filter; this deliberately does not.
    let list = resolveConversationKinds({ templateKind: 'buurt' });
    for (const k of [...list]) {
      const row = conversationKindsRows({ circleSetting: list }).find((r) => r.kind === k);
      list = row.next;
    }
    expect(list).toEqual([]);
    expect(resolveConversationKinds({ circleSetting: [] })).toEqual([]);
  });

  it('the rows agree with what the conversation will actually render', () => {
    const rows = conversationKindsRows({ templateKind: 'friends' });
    const shown = resolveConversationKinds({ templateKind: 'friends' });
    for (const r of rows) expect(r.on).toBe(shown.includes(r.kind));
  });
});
