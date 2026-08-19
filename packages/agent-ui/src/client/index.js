/**
 * @onderling/agent-ui/client — A2A-wire-shape client for talking to a
 * `mountLocalUi`-served agent (or any A2A endpoint).
 *
 * Legacy `AgentUiClient` (bespoke `POST /api/skills/:id` shape) was
 * deleted 2026-05-04 once all three consumers (tasks-v0,
 * neighbourhood-v0, archive) migrated to A2A.
 */

export { LocalAgentClient } from './LocalAgentClient.js';
