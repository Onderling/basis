/**
 * @onderling/agent-ui/server — server-side primitives.
 *
 * Localhost-only framing (per L1d sketch, re-scoped 2026-05-04):
 * `mountLocalUi` wraps `core.A2ATransport` on `127.0.0.1` so a UI
 * process running on the same host can talk to its own agent over
 * the standard A2A wire shape:
 *
 *   GET  /.well-known/agent.json
 *   POST /tasks/send                 → run skill, return JSON result
 *   POST /tasks/sendSubscribe        → run skill, return SSE stream
 *   POST /tasks/:id/cancel
 *   GET  /tasks/:id
 *
 * The substrate doesn't reimplement A2A — that's `core.A2ATransport`'s
 * job, with full `taskExchange.handleTaskRequest` dispatch (PolicyEngine,
 * group filtering, capability tokens, streaming, IR, TTL, abort).
 *
 * Legacy primitives (composeAgent / SkillRouter / EventBroadcaster /
 * ctxActor) were deleted 2026-05-04 once all three consumers
 * (tasks-v0, neighbourhood-v0, archive) migrated to the real `core.Agent`
 * dispatch path.
 */

export { mountLocalUi } from './mountLocalUi.js';
export { LocalUiAuth }  from './LocalUiAuth.js';
