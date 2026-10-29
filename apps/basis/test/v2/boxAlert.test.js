/**
 * The box's alert chat, from inside the device: the same line the box updater sends, from the same two settings;
 * nothing when they are unset; and a failed send never carries the token (it is in the bot API's URL).
 */
import { describe, it, expect } from 'vitest';
import { createBoxAlert } from '../../src/v2/boxAlert.js';

const TOKEN = '123:SECRET-BOT-TOKEN';

describe('the box alert chat', () => {
  it('unset (no token or no chat): no sender, so the caller says it elsewhere', () => {
    expect(createBoxAlert({ token: '', chat: '42' })).toBeNull();
    expect(createBoxAlert({ token: TOKEN, chat: '' })).toBeNull();
  });

  it('sends one line to the chat, named for the box, in the updater\'s shape', async () => {
    const sent = [];
    const alert = createBoxAlert({ token: TOKEN, chat: '42', name: 'tablet', fetchImpl: async (url, init) => { sent.push({ url, body: new URLSearchParams(init.body) }); return { ok: true }; } });
    await alert('the key no longer works (401)');
    expect(sent).toHaveLength(1);
    expect(sent[0].body.get('chat_id')).toBe('42');
    expect(sent[0].body.get('text')).toBe('[box tablet] the key no longer works (401)');
  });

  it('a failed send throws without the token in it', async () => {
    const alert = createBoxAlert({ token: TOKEN, chat: '42', fetchImpl: async (url) => { throw new Error(`fetch failed for ${url}`); } });
    const err = await alert('x').catch((e) => e);
    expect(String(err?.message)).toBe('alert failed (telegram)');
    expect(String(err?.stack ?? '')).not.toContain('SECRET-BOT-TOKEN');
  });
});
