/**
 * A credential that rides in a URL leaks wherever an error's message is printed: a fetch error's message is the request
 * URL, and a Telegram bot's URL carries the bot token (the household box wrote it into 50 walk-log lines, 2026-10-18).
 * `scrubSecrets` takes the credential out of any text before it reaches a log, a console or a chat.
 */
import { describe, it, expect } from 'vitest';
import { scrubSecrets } from '../src/index.js';

describe('scrubSecrets', () => {
  it('a Telegram bot token in a URL', () => {
    const t = 'request to https://api.telegram.org/bot123456789:AAH-x_Yz0123456789abcdefghijklmnopq/setMyCommands failed, reason: getaddrinfo EAI_AGAIN';
    const s = scrubSecrets(t);
    expect(s).not.toContain('AAH-x_Yz');
    expect(s).not.toContain('123456789:');
    expect(s).toContain('/setMyCommands failed, reason: getaddrinfo EAI_AGAIN');
  });
  it('a password in a URL, and a credential in a query', () => {
    expect(scrubSecrets('GET https://me:hunter2@pod.example/x')).not.toContain('hunter2');
    const q = scrubSecrets('https://api.example/v1?model=a&api_key=sk-abc123&token=t0k&x=1');
    expect(q).not.toMatch(/sk-abc123|t0k/);
    expect(q).toContain('model=a');
    expect(q).toContain('x=1');
  });
  it('ordinary text is unchanged; a non-string is made a string', () => {
    expect(scrubSecrets('409: Conflict: terminated by other getUpdates request')).toBe('409: Conflict: terminated by other getUpdates request');
    expect(scrubSecrets(undefined)).toBe('undefined');
  });
});
