import { describe, it, expect } from 'vitest';
import { relayTexts, currentHits } from './lint-no-relay-word.mjs';

describe('lint-no-relay-word — "relay" is not shown to a person', () => {
  it('finds "relay" in a text a person reads, at any depth', () => {
    const tree = { a: { text: 'Welke relay gebruik je?', doc: 'x' }, b: { c: { text: 'Je verbindingspunt' } } };
    expect(relayTexts(tree)).toEqual(['.a']);
  });
  it('no exception for what a person types: the old command and mode words fail; a placeholder name passes', () => {
    const tree = {
      a: { text: 'Probeer /set-relay ws://host:poort of /set-relay --clear' },
      b: { text: 'Onbekend transport: {{mode}} (gebruik nkn, relay of both)' },
      c: { text: 'Verbonden met {{relay}}' },
    };
    expect(relayTexts(tree)).toEqual(['.a', '.b']);
  });
  it('a doc line about relays is for the developer, not the person: only `text` counts', () => {
    expect(relayTexts({ a: { text: 'Verbindingspunt', doc: 'the relay endpoint' } })).toEqual([]);
  });
  it('the app shows none today', () => {
    expect(currentHits()).toEqual([]);
  });
});
