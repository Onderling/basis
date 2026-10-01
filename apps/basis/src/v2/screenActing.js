/**
 * screenActing — who a connected screen acts AS, on a household bot (Fable, setup brief §7).
 *
 * A screen (the person's own app, connected to the bot) reaches the bot's ops as kernel skills (`renderA2A`), with a
 * capability token the bot minted for it. The token says "this screen may call this op"; it does not say "as whom".
 * On a person's own agent that is fine — the screen IS the owner. On a bot it is not: run as the host, a screen's call
 * would skip every rule the door applies to a person (the role map, the names ceiling, who may give chores, who may
 * cancel). So the bot answers a screen AS the person in the token's signed `actingAs`, through the door's own call —
 * the same gate as that person's typed line — and refuses a call with no person, or a person not in its book.
 */

/** The bot's ops a screen never reaches, whatever token it holds: reading a file back, or pairing more screens. */
export const BOT_SCREEN_NEVER = Object.freeze([
  'assistant.assistant-import',
  'assistant.assistant-export',
  'assistant.assistant-exports',
]);

/**
 * The `ctxFor` for `renderA2A` on a bot: the verified call's token's `actingAs`, when that person is in the book.
 * @param {{list: () => Promise<Array<{id: string, hidden?: boolean}>>}} users  the bot's book (revoked rows are not listed)
 * @returns {(handlerCtx: object) => Promise<{caller: string, threadId: string}|null>}
 */
export function screenActsAs(users) {
  return async (hctx) => {
    const token = hctx?.envelope?.payload?._token ?? null;
    const actingAs = token?.constraints?.actingAs;
    if (typeof actingAs !== 'string' || !actingAs) return null;
    const row = ((await users.list()) ?? []).find((u) => u?.id === actingAs && !u.hidden);
    return row ? { caller: actingAs, threadId: actingAs } : null;
  };
}
