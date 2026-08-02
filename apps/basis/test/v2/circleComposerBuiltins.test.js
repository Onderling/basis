// L1 — Phase 4 §10 / G17 — composer slash dispatch: `/set-relay`, `/transport-mode` (+ `/settings`,
// `/transports`) classify as circle/transport BUILT-INS (fire the settings/transport op) and are NOT
// routed to the bot/LLM. Everything else returns null so the shell continues to the bot.
import { describe, it, expect } from 'vitest';
import { parseCircleBuiltin, CIRCLE_BUILTIN_COMMANDS } from '../../src/v2/circleComposerBuiltins.js';
import manifest from '../../manifest.js';

describe('G17 — composer built-in classifier', () => {
  it('/set-relay <url> fires the set-relay op with the url', () => {
    expect(parseCircleBuiltin('/set-relay wss://relay.example')).toEqual({
      command: 'set-relay', opId: 'set-relay', args: { url: 'wss://relay.example' },
    });
  });
  it('/set-relay --clear fires the set-relay op with clear', () => {
    expect(parseCircleBuiltin('/set-relay --clear')).toEqual({
      command: 'set-relay', opId: 'set-relay', args: { clear: true },
    });
  });
  it('bare /set-relay fires the op with no args (opens the panel/form)', () => {
    expect(parseCircleBuiltin('/set-relay')).toEqual({ command: 'set-relay', opId: 'set-relay', args: {} });
  });

  it('/transport-mode <mode> fires the transport-mode op', () => {
    expect(parseCircleBuiltin('/transport-mode relay')).toEqual({
      command: 'transport-mode', opId: 'transport-mode', args: { mode: 'relay' },
    });
    expect(parseCircleBuiltin('/transport-mode BOTH').args).toEqual({ mode: 'both' });
  });

  it('/settings fires the settings op (built-in path); /settings --lang=nl carries the lang', () => {
    expect(parseCircleBuiltin('/settings')).toEqual({ command: 'settings', opId: 'settings', args: {} });
    expect(parseCircleBuiltin('/settings --lang=nl').args).toEqual({ lang: 'nl' });
  });

  it('/transports fires the transports op', () => {
    expect(parseCircleBuiltin('/transports')).toEqual({ command: 'transports', opId: 'transports', args: {} });
  });

  it('does NOT capture ordinary chat or other slash commands (→ null → bot handles it)', () => {
    expect(parseCircleBuiltin('hello there')).toBeNull();
    expect(parseCircleBuiltin('/addtask buy milk')).toBeNull();
    expect(parseCircleBuiltin('/help')).toBeNull();
    expect(parseCircleBuiltin('@assistant set the relay please')).toBeNull();   // NL text → bot, not built-in
    expect(parseCircleBuiltin('')).toBeNull();
    expect(parseCircleBuiltin(null)).toBeNull();
  });

  it('the built-in command set matches the manifest slash surfaces it dispatches', () => {
    // 2026-08-02 — this asserted a hardcoded literal while its NAME promised a manifest check, so adding
    // `/security-status` (a declared slash surface since v0.7) failed it for the wrong reason: the list
    // was stale, not the change. It now reads the manifest, which is what invariant 4 says is the source
    // of truth for surfaces — and it will now fail if a builtin is classified that the manifest does not
    // declare, which is the property worth having.
    const declared = new Set(
      (manifest.operations ?? [])
        .map((op) => op?.surfaces?.slash?.command)
        .filter((c) => typeof c === 'string')
        .map((c) => c.replace(/^\//, '')),
    );
    for (const command of CIRCLE_BUILTIN_COMMANDS) {
      expect(declared.has(command), `/${command} is classified as a built-in but not declared in the manifest`)
        .toBe(true);
    }
  });
});
