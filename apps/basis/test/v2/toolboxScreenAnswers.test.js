/**
 * The household bot's toolboxes on the admin's MANAGEMENT SCREEN (ledger L1035; development went red when the toolboxes landed,
 * screen-buttons-box): every button there must answer in words. `listTools` says which toolboxes are on, or that none
 * is, in the words the `/toolbox` door uses (one function, `toolboxListLine`); `useTool` is no button on a screen at
 * all: a toolbox is used by its word in the chat.
 */
import { describe, it, expect } from 'vitest';
import { toolboxListLine } from '../../src/v2/toolboxes.js';
import { BOT_SCREEN_NEVER, SCREEN_NO_BUTTON } from '../../src/v2/screenActing.js';

const tp = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);

describe('the toolboxes on the management screen', () => {
  it('the list in words: none on, none placed, or a head and a row per toolbox', () => {
    expect(toolboxListLine([], tp)).toBe('circle.bot.toolbox_none_on');
    expect(toolboxListLine([], tp, { all: true })).toBe('circle.bot.toolbox_none');
    const line = toolboxListLine([{ name: 'boodschappen', title: 'Boodschappen', on: true, words: [{ word: 'zoek' }] }], tp);
    expect(line.split('\n')[0]).toBe('circle.bot.toolbox_list_head');
    expect(line).toContain('Boodschappen');
    expect(line).toContain('zoek <…>');
  });
  it('using a tool is no button on a screen, and a screen may call it (a toolbox\'s own page)', () => {
    expect(SCREEN_NO_BUTTON).toContain('tools.useTool');
    expect(BOT_SCREEN_NEVER).not.toContain('tools.useTool');
  });
});
