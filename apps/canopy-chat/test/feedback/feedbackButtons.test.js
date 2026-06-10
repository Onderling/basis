import { describe, it, expect } from 'vitest';
import {
  feedbackButtonItems, decodeFeedbackButton, FEEDBACK_BUTTON_OP,
} from '../../src/feedback/feedbackSurface.js';

// The bot emits buttons as { id, label } where id is a control id with COLONS (fp:escalate:yes).
const BUTTONS = [
  { id: 'fp:escalate:yes', label: 'Yes, escalate' },
  { id: 'fp:consent:all', label: 'Share all' },
  { id: 'fp:cancel', label: 'Cancel' },
];

describe('M12 — feedbackButtonItems', () => {
  it('renders one chip row whose buttons re-send the control id (colon-safe)', () => {
    const payload = feedbackButtonItems(BUTTONS);
    expect(payload.items).toHaveLength(1);
    const chips = payload.items[0].buttons;
    expect(chips.map((c) => c.label)).toEqual(['Yes, escalate', 'Share all', 'Cancel']);
    // callbackData is opId:itemId; the multi-colon control id is URI-encoded so the shell's split survives
    expect(chips[0].callbackData).toBe(`${FEEDBACK_BUTTON_OP}:fp%3Aescalate%3Ayes`);
    const [opId, itemId] = chips[0].callbackData.split(':');
    expect(opId).toBe(FEEDBACK_BUTTON_OP);
    expect(decodeFeedbackButton(itemId)).toBe('fp:escalate:yes');   // round-trips back to the bot control id
  });

  it('round-trips every control id through encode → split → decode', () => {
    const chips = feedbackButtonItems(BUTTONS).items[0].buttons;
    for (let i = 0; i < BUTTONS.length; i++) {
      const itemId = chips[i].callbackData.split(':')[1];
      expect(decodeFeedbackButton(itemId)).toBe(BUTTONS[i].id);
    }
  });

  it('returns null for empty / malformed buttons (falls back to text)', () => {
    expect(feedbackButtonItems([])).toBeNull();
    expect(feedbackButtonItems(undefined)).toBeNull();
    expect(feedbackButtonItems([{ label: 'no id' }, { id: 'x' }])).toBeNull();   // none valid
  });

  it('drops individually-malformed buttons but keeps valid ones', () => {
    const payload = feedbackButtonItems([{ id: 'fp:ok', label: 'OK' }, { label: 'no id' }]);
    expect(payload.items[0].buttons).toHaveLength(1);
    expect(payload.items[0].buttons[0].label).toBe('OK');
  });
});
