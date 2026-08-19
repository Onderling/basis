/**
 * mountLocalUi — start an A2A HTTP server bound to localhost so this
 * process's UI (browser tab, RN app, CLI) can reach its own agent.
 *
 * This is the localhost-only framing of L1d (per `Project Files/Substrates/L1d-agent-ui.md`):
 * the substrate composes `core.A2ATransport` against a real `core.Agent`,
 * defaulting to bind on `127.0.0.1` so the server isn't exposed to the LAN.
 * No new wire shape is invented — the server is plain A2A:
 *   GET  /.well-known/agent.json
 *   POST /tasks/send
 *   POST /tasks/sendSubscribe   (SSE)
 *   POST /tasks/:id/cancel
 *   GET  /tasks/:id
 *
 * Skill visibility, group filtering, capability tokens, streaming, IR, TTL,
 * and abort all flow through `core.taskExchange.handleTaskRequest` exactly
 * as for any A2A peer — no `composeAgent`-style synthetic agent shape.
 *
 * @example
 *   import { Agent, defineSkill } from '@onderling/core';
 *   import { mountLocalUi } from '@onderling/agent-ui';
 *   const agent = await Agent.createNew({ transport, label: 'TasksAgent' });
 *   agent.register(defineSkill('echo', async ({parts}) => parts));
 *   const ui = await mountLocalUi(agent, { port: 8888 });
 *   console.log(`UI server at ${ui.url}`);
 *   // ... when shutting down:
 *   await ui.stop();
 */

import { A2ATransport } from '@onderling/core';

/**
 * @param {import('@onderling/core').Agent} agent
 *   A real `core.Agent` with skills already registered.
 * @param {object} [opts]
 * @param {number} [opts.port=0]      HTTP port. 0 → OS picks a free port.
 * @param {string} [opts.host='127.0.0.1']
 *   Bind interface. Default localhost-only — the substrate's whole point.
 *   Pass `'0.0.0.0'` only if you understand the security implications
 *   (the bare `core.A2ATransport` is the right primitive for that case).
 * @param {string} [opts.baseUrl]     Optional public URL (rare for localhost).
 * @param {object} [opts.a2aTLSLayer] Optional `A2ATLSLayer` (TLS at the agent level — usually not needed for localhost).
 * @param {string} [opts.staticDir]
 *   Optional directory containing a per-app web UI (HTML/JS/CSS) served
 *   alongside the A2A endpoints. The browser POSTs to `/tasks/send` etc.
 *   directly — no SDK needed in the page. Path-traversal-hardened. Used
 *   by H5 V2's per-member web UI (Phase 7); see
 *   `apps/neighbourhood-v0/web/` for the canonical example.
 * @param {string} [opts.indexFile='index.html']
 *   File served when the requested path is `/`.
 * @param {Record<string, string|Uint8Array>} [opts.extraStaticFiles]
 *   In-memory virtual files served alongside `staticDir` (checked first,
 *   so a virtual `/foo.json` overrides a disk `staticDir/foo.json`).
 *   Used by the H5 multi-group launcher to surface a runtime `groups.json`
 *   without writing to the source tree.
 * @returns {Promise<{
 *   url: string,
 *   port: number,
 *   transport: A2ATransport,
 *   stop: () => Promise<void>,
 * }>}
 */
export async function mountLocalUi(agent, opts = {}) {
  if (!agent || typeof agent !== 'object') {
    throw new TypeError('mountLocalUi: agent (a core.Agent instance) is required');
  }
  if (typeof agent.register !== 'function' || typeof agent.skills !== 'object') {
    throw new TypeError(
      'mountLocalUi: agent must be a core.Agent (got an object missing .register/.skills — '
      + 'the synthetic {invokeSkill} shape from old composeAgent is not supported)',
    );
  }

  const {
    port             = 0,
    host             = '127.0.0.1',
    baseUrl          = null,
    a2aTLSLayer      = null,
    staticDir        = null,
    indexFile        = 'index.html',
    extraStaticFiles = null,
  } = opts;

  const transport = new A2ATransport({
    agent,
    port,
    host,
    baseUrl,
    a2aTLSLayer,
    staticDir,
    indexFile,
    extraStaticFiles,
  });
  await transport.connect();

  const actualPort = transport.serverPort;
  const url        = baseUrl ?? `http://${host}:${actualPort}`;

  const stop = async () => {
    await transport.disconnect();
  };

  return { url, port: actualPort, transport, stop };
}
