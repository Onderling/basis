/**
 * Telegram gets the bot's words as PLAIN text (no parse mode), so the model's markdown arrived literally — "**Taken**"
 * with its stars (the household's chat, L413). The projector turns markdown into plain text at the one send point.
 */
import { describe, it, expect } from 'vitest';
import { telegramPlain } from '../../src/telegram/telegramPlain.js';

describe('telegramPlain', () => {
  it('drops bold, italic and code marks, keeps the words', () => {
    expect(telegramPlain('**Taken** voor vandaag: __afwas__ en `stofzuigen`')).toBe('Taken voor vandaag: afwas en stofzuigen');
    expect(telegramPlain('Dat is *heel* fijn')).toBe('Dat is heel fijn');
  });
  it('headings lose their hashes, list stars become bullets, links keep both words and address', () => {
    expect(telegramPlain('## Deze week\n* boodschappen\n- ramen')).toBe('Deze week\n• boodschappen\n• ramen');
    expect(telegramPlain('Zie [de site](https://onderling.org)')).toBe('Zie de site (https://onderling.org)');
  });
  it('leaves what is not markdown alone', () => {
    expect(telegramPlain('2 * 3 = 6, en a_b_c blijft')).toBe('2 * 3 = 6, en a_b_c blijft');
    expect(telegramPlain('gewoon een zin.')).toBe('gewoon een zin.');
    expect(telegramPlain('')).toBe('');
  });
});
