// The screen client a toolbox's page imports (onderling-screen-client.js). Hand-written beside the source; the build
// copies it next to the one file. Every refusal's code is listed below.

/** The client's version (also in the VERSION file beside the build). */
export const SCREEN_CLIENT_VERSION: string;

/** Every refusal's code. `grant-expired` is one code for a grant that ran out and one taken away: pair again. */
export type ScreenClientCode =
  | 'not-paired' | 'grant-expired' | 'rate-limited' | 'no-connection' | 'timeout' | 'aborted' | 'op-not-allowed'
  | 'toolbox-unreachable' | 'toolbox-not-yours' | 'answer-too-large' | 'tool-error' | 'not-found' | 'failed'
  /** this page's own key in this browser is there but will not read: `signOut()`, then pair again */
  | 'key-unreadable';
export const SCREEN_CLIENT_CODES: readonly ScreenClientCode[];

/** How long a call waits without its own `timeoutMs` (30 000). */
export const SCREEN_CALL_TIMEOUT_MS: number;

export type ScreenState = 'not-paired' | 'connected' | 'busy' | 'broken';

/** A refusal: never thrown, always answered. */
export interface ScreenRefusal {
  ok: false;
  code: ScreenClientCode;
  message?: string;
  /** with `tool-error`: the toolbox's own error, unchanged */
  toolError?: { code: string; params: Record<string, unknown> };
}

export interface ScreenClient {
  readonly version: string;
  readonly toolbox: string;
  state(): ScreenState;
  /** Hear every change of state; returns the unsubscribe. */
  onState(fn: (s: ScreenState) => void): () => void;
  /** Resolves when the state is `s`; rejects with code `aborted` on the signal. */
  whenState(s: ScreenState, o?: { signal?: AbortSignal }): Promise<ScreenState>;
  /** Back with what this browser kept; `not-paired` when nothing is kept here ("pair again"). */
  resume(): Promise<{ ok: true } | ScreenRefusal>;
  /** Pairing, step one: what the person pastes into their chat with the bot, the code to show, when the ten minutes end. */
  startPairing(): Promise<{ paste: string; code: string; expiresAt: number }>;
  /** Pairing, step two. */
  waitForGrant(o?: { signal?: AbortSignal }): Promise<'granted' | 'refused' | 'expired' | 'aborted'>;
  /** The ops this screen may call (`app.op`). */
  ops(): string[];
  /** Hear that something the screen reads changed (read again); returns the unsubscribe. */
  onNudge(fn: () => void): () => void;
  /**
   * Call one of the bot's ops as the person. Never throws. Calls may run at once; past the bot's budget (3 a second,
   * a burst of 60, per screen) the answer is `rate-limited`. `tools.useTool` answers `{ok: true, output}` with the
   * toolbox's own output, and only for this client's own toolbox.
   */
  call<T = unknown>(op: string, input?: Record<string, unknown>, o?: { signal?: AbortSignal; timeoutMs?: number }): Promise<(T & { ok?: true }) | ScreenRefusal>;
  /** This toolbox's grant and key leave this browser. */
  signOut(): Promise<{ ok: true }>;
}

export function createScreenClient(o: {
  /** the toolbox this page belongs to: the bot pairs it for that toolbox only */
  toolbox: string;
  /** the bot's screen start link (`…#scherm-nieuw=…`, the admin's /scherm), given once */
  bot: string;
  /** how the person's chat names this page */
  label?: string;
  /** where the grant and the key are kept (default: localStorage) */
  storage?: Storage;
}): ScreenClient;

/** The client's code for what a call threw or answered (null for an answer that is no refusal). */
export function screenClientCode(err: unknown, answer?: unknown): ScreenClientCode | null;
