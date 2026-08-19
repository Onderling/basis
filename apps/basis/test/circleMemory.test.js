/**
 * circleMemory — recent circle turns as interpret context (conversation memory).
 */
import { describe, it, expect } from 'vitest';
import { recentCircleTurns } from '../src/v2/circleMemory.js';

const row = (ts, actor, text) => ({ id: `r${ts}`, ts, actor, event: { payload: { kind: 'chat-message', text } } });

describe('recentCircleTurns', () => {
  it('formats turns as you:/assistant:, chronological, capped to the limit', () => {
    const rows = [
      row(3, 'bot', 'Added milk'),
      row(1, 'me', 'add milk'),
      row(4, 'me', 'and bread'),
      row(2, 'bot', 'ok'),
    ];
    expect(recentCircleTurns({ rows, limit: 3 })).toEqual([
      'assistant: ok',
      'assistant: Added milk',
      'you: and bread',
    ]);
  });

  it('skips non-chat rows + empty text', () => {
    const rows = [
      row(1, 'me', '  '),
      { id: 'x', ts: 2, actor: 'me', event: { payload: { kind: 'circle-post', text: 'a post' } } },
      row(3, 'bot', 'real reply'),
    ];
    expect(recentCircleTurns({ rows })).toEqual(['assistant: real reply']);
  });

  it('returns [] for no/garbage rows', () => {
    expect(recentCircleTurns()).toEqual([]);
    expect(recentCircleTurns({ rows: null })).toEqual([]);
  });
});
