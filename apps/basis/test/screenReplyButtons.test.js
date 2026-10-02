/**
 * A reply's quick replies, on a screen: each `{label, slash}` resolved by the SCREEN's own parser over its own
 * manifests into an op and args — the bot's text is a menu, never run as text; a button only when the screen holds a
 * token for that op (the screen ops, `/bevestig`, anything withheld are left out); the op's own confirm rides along.
 * And the door's `/instellingen` asked from a screen answers with its buttons, whatever the person's chat view is.
 */
import { describe, it, expect } from 'vitest';
import { screenReplies } from '../src/v2/screenPaint.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';

const ADMIN_OPS = ['assistant.assistant-settings', 'assistant.assistant-reminders', 'assistant.assistant-language', 'assistant.assistant-menu', 'assistant.assistant-rotate'];

describe('screenReplies', () => {
  it('resolves each slash into the op and its declared args, with the op\'s confirm', () => {
    const out = screenReplies({ quickReplies: [
      { label: 'Namen zien: niemand', slash: '/huishouden names none' },
      { label: 'Herinneringen: aan', slash: '/herinneringen on' },
      { label: 'Taal: en', slash: '/taal en' },
    ] }, ADMIN_OPS);
    const settings = out.find((b) => b.label === 'Namen zien: niemand');
    expect(settings).toMatchObject({ skill: 'assistant.assistant-settings', args: { change: 'names none' } });
    expect(settings.confirm?.when).toContain('names none');
    expect(out.find((b) => b.label === 'Herinneringen: aan')).toMatchObject({ skill: 'assistant.assistant-reminders', args: { mode: 'on' } });
    expect(out.find((b) => b.label === 'Taal: en')).toMatchObject({ skill: 'assistant.assistant-language', args: { lang: 'en' } });
    for (const b of out) expect(Object.keys(b.args)).not.toContain('_match');
  });

  it('a button for an op the screen holds no token for is left out — /scherm, /bevestig, /apps, an unknown line', () => {
    const out = screenReplies({ quickReplies: [
      { label: 'scherm', slash: '/scherm' },
      { label: 'ja', slash: '/bevestig ja 7K2P' },
      { label: 'apps', slash: '/apps on tasks' },
      { label: 'onzin', slash: 'rm -rf /' },
      { label: 'Taal: en', slash: '/taal en' },
    ] }, ['assistant.assistant-language']);
    expect(out.map((b) => b.label)).toEqual(['Taal: en']);
  });

  it('no quick replies: no buttons', () => {
    expect(screenReplies({ ok: true, message: 'x' }, ADMIN_OPS)).toEqual([]);
    expect(screenReplies(null, ADMIN_OPS)).toEqual([]);
  });
});

describe('the door\'s /instellingen from a screen', () => {
  it('answers with its buttons even when the person\'s chat view is the screen', async () => {
    const call = withAssistantOps({
      callSkill: async () => ({ params: [] }), t: (k) => k, refusal: async () => null,
      threads: { langOf: () => null, viewOf: () => 'screen', modeOf: () => 'short', remindersOn: () => true, overviewOn: () => false },
      admin: { users: async () => [{ id: 'telegram:9', channel: 'telegram', uid: '9', role: 'admin' }], screens: { list: async () => [{}] } },
    });
    const typed = await call('assistant', 'assistant-menu', {}, { caller: 'telegram:9', threadId: 'telegram:9', chatId: '9' });
    expect(typed.quickReplies).toBeUndefined();   // in the chat: "your menu is on your screen"
    const fromScreen = await call('assistant', 'assistant-menu', {}, { caller: 'telegram:9', threadId: 'telegram:9', via: 'screen', viewPubKey: 'V' });
    expect(Array.isArray(fromScreen.quickReplies) && fromScreen.quickReplies.length).toBeTruthy();
  });
});
