// Feedback surface for canopy-chat — hosts the feedback-pipeline bot inside the chat shell.
// canopy-chat's free-text path is otherwise a dead end; when a thread is in FEEDBACK MODE
// (entered via /feedback), free text is routed to the bot, which runs the on-device floor +
// the same review/consent journey as Telegram.
//
// M1.4 — the bot is CO-HOSTED on the participant's shared @canopy/core InternalBus via the
// production InternalBusBridge (no network), and consent is SIGNED with the participant's own
// identity (so a verify-enabled project accepts it). The bot OWNS its LLM route (resolved from
// config.llm via the M0 guardrail — never a separate setLlmRoute here), so raw pre-consent text
// can only reach a safe (local/loopback/attested) model. DOM-free + testable: the host injects
// `emit(reply)` — the sink that renders a bot reply ({chatId, text, buttons}) into the thread.

import { InternalBus } from '../../../../packages/core/src/transport/InternalTransport.js';
import { InternalBusBridge, connectFeedbackParticipant } from '../../../feedback-pipeline/src/channel/internal-bus-bridge.js';
import { CanopyChatBot } from '../../../feedback-pipeline/src/channel/canopy-chat-bot.js';
import { InMemoryCentralPod } from '../../../feedback-pipeline/src/pod/central-pod.js';
import { validateProjectConfig, exampleProjectConfig } from '../../../feedback-pipeline/src/config/project-config.js';
import { applyLlmRoute, assertCleanRouteSafe } from '../../../feedback-pipeline/src/ollama.js';

/**
 * @param {object} a
 * @param {object} [a.config]     a feedback ProjectConfig (defaults to the worked example). The
 *                                LLM route lives in `config.llm` (set config.llm.baseURL in the
 *                                browser — the bot owns the route).
 * @param {object} [a.pod]        a CentralPod (value/Promise/thunk); defaults to in-memory
 * @param {object} [a.bus]        the participant's shared InternalBus (defaults to a private one)
 * @param {{publicKey:string,privateKey:string}} [a.identity]  the participant's signing identity
 *                                (consent is signed when present; from the canopy-chat vault)
 * @param {(chatId:string)=>object} [a.identityFor]  per-thread identity (defaults to `identity`)
 * @param {(reply:{chatId:string,text:string,buttons?:Array})=>void} a.emit  render sink
 */
export function createFeedbackSurface({ config, pod, bus, identity, identityFor, llmBaseURL, emit } = {}) {
  if (typeof emit !== 'function') throw new Error('createFeedbackSurface: emit(reply) is required');
  const cfg = validateProjectConfig(config || exampleProjectConfig);
  // route ownership → the bot: the route lives in config.llm; `llmBaseURL` is the browser's
  // no-env convenience to point config.llm at its (local/loopback) endpoint. Install + M0
  // safety-check the clean route up front.
  if (llmBaseURL) cfg.llm.baseURL = llmBaseURL;
  applyLlmRoute(cfg.llm || {});
  assertCleanRouteSafe(cfg.llm || {});

  const sharedBus = bus || new InternalBus();
  const idFor = identityFor || (identity ? () => identity : undefined);

  // one co-hosted bot multiplexes all threads (keyed by chatId); pod resolved lazily so a real
  // CssCentralPod (built from the browser session after activation) can be supplied async.
  let botPromise = null;
  const bot = () => (botPromise ||= (async () => {
    const resolved = (typeof pod === 'function' ? await pod() : await pod) || new InMemoryCentralPod();
    const bridge = new InternalBusBridge({ bus: sharedBus, address: 'fp-bot' });
    const b = new CanopyChatBot({ bridge, pod: resolved, config: cfg, identityFor: idFor });
    await b.start();
    return b;
  })());

  const clients = new Map();   // threadId -> participant bus client
  const clientFor = async (threadId) => {
    await bot();   // ensure the bot is co-hosted before a participant connects
    const id = String(threadId);
    if (!clients.has(id)) clients.set(id, connectFeedbackParticipant(sharedBus, { botAddress: 'fp-bot', chatId: id, onReply: (r) => emit(r) }));
    return clients.get(id);
  };

  const active = new Set();
  return {
    /** Enter feedback mode for a thread and show the bot's guidance. */
    async start(threadId) { active.add(String(threadId)); await (await clientFor(threadId)).send('/help'); },
    /** Leave feedback mode. */
    stop(threadId) { active.delete(String(threadId)); clients.get(String(threadId))?.close(); clients.delete(String(threadId)); },
    isActive(threadId) { return active.has(String(threadId)); },
    /** Route a free-text turn to the bot IF the thread is in feedback mode. */
    async handle(text, threadId) {
      if (!active.has(String(threadId))) return false;
      await (await clientFor(threadId)).send(text);
      return true;
    },
    /** A button tap (M2): send the control id (fp:*) as a turn — the bot's parseControl handles it. */
    async tapButton(buttonId, threadId) {
      if (!active.has(String(threadId))) return false;
      await (await clientFor(threadId)).send(buttonId);
      return true;
    },
  };
}

/**
 * Parse a project-invite (M2). Accepts a full URL, a query string, or a URLSearchParams and
 * returns `{ projectId, code }` when both are present (the shape `inviteLink()` produces), else
 * null. Used to auto-run `/feedback <code>` when the app loads on an invite/QR link.
 */
export function parseFeedbackInvite(input) {
  let params;
  try {
    if (input instanceof URLSearchParams) params = input;
    else if (typeof input === 'string' && input.includes('?')) params = new URL(input, 'https://x.invalid').searchParams;
    else params = new URLSearchParams(input || '');
  } catch { return null; }
  const projectId = params.get('projectId');
  const code = params.get('code');
  return projectId && code ? { projectId, code } : null;
}

/**
 * The feedback bot as a distinct **agent** contact item (M2). NOT a stoop mesh peer — a local
 * co-hosted assistant, surfaced in the contacts list with its own `kind:'agent'` + icon and an
 * action (`openFeedback`) that enters feedback mode rather than opening a peer DM. The chat shell
 * prepends this to the `/contacts` list and routes its button to feedback mode. Its `id` matches
 * the co-hosted bot address (`fp-bot`).
 *
 * @param {{label?:string, openLabel?:string}} [a]
 */
export function feedbackContactItem({ label = 'Feedback assistant', openLabel = 'Open chat' } = {}) {
  return {
    id:      'fp-bot',
    type:    'agent',
    kind:    'agent',
    icon:    '🤖',
    label,
    buttons: [{ label: openLabel, callbackData: 'openFeedback:fp-bot' }],
  };
}

/** callbackData opId for a feedback action chip (M12). */
export const FEEDBACK_BUTTON_OP = 'fpTap';

/**
 * M12 — turn the bot's emitted buttons (`{id, label}`, the review/consent/escalate actions) into
 * INTERACTIVE chips instead of plain text bullets. Returns a one-row list payload (`{items}`) whose
 * buttons re-send the control id to the bot on tap. The control id (`fp:*`) contains colons, which the
 * shell's `opId:itemId` callbackData split would mangle — so it's URI-encoded here and decoded by
 * `decodeFeedbackButton` in the tap handler. Returns null when there are no buttons.
 */
export function feedbackButtonItems(buttons) {
  const list = (Array.isArray(buttons) ? buttons : []).filter((b) => b && b.id && b.label);
  if (list.length === 0) return null;
  return {
    items: [{
      id:      'fp-actions',
      label:   '',
      buttons: list.map((b) => ({ label: b.label, callbackData: `${FEEDBACK_BUTTON_OP}:${encodeURIComponent(b.id)}` })),
    }],
  };
}

/** Decode a feedback chip's `itemId` (URI-encoded control id) back to the bot control id. */
export function decodeFeedbackButton(itemId) {
  try { return decodeURIComponent(String(itemId ?? '')); } catch { return String(itemId ?? ''); }
}
