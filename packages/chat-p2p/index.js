/**
 * @onderling/chat-p2p — peer-to-peer chat substrate.
 *
 * **Layer:** substrate. Cross-platform (no DOM, no Expo, no RN).
 *
 * Lifted from `apps/pinboard/src/chat/wireChat.js` 2026-05-08 (Tasks V1
 * = rule-of-two consumer per
 * `Project Files/Pinboard/migration-tasks-v1-lifts-2026-05-08.md`).
 *
 * Distinct from `@onderling/chat-agent` (LLM-mediated chat — that's
 * for human ↔ AI assistant). This package is human ↔ human chat
 * over `agent.transport.sendOneWay`.
 *
 * The substrate exposes a single factory `wireChat({...})` that
 * registers an `agent.on('message', ...)` handler for chat
 * envelopes and returns `{ send, detach }`. App-specific concerns
 * (item-store shape, MemberMap, attachments, eviction) plug in via
 * dependency injection.
 *
 * **Envelope types.** Default `emitEnvelopeType: 'p2p-chat'` for
 * new deployments. `acceptedEnvelopeTypes` defaults to both
 * `'p2p-chat'` AND `'pinboard-chat'` (legacy) so a peer running the
 * old code can still talk to a peer running the new code. Apps
 * tweak via constructor:
 *
 *     wireChat({
 *       emitEnvelopeType:    'pinboard-chat',                      // back-compat sender
 *       acceptedEnvelopeTypes: ['p2p-chat', 'pinboard-chat'],      // accept both
 *       ...
 *     });
 */

export { wireChat } from './src/wireChat.js';
