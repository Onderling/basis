/**
 * A2ATransport — HTTP server (inbound A2A tasks) + HTTP client (outbound).
 *
 * Server endpoints (Node.js only, started when `port` is provided):
 *   GET  /.well-known/agent.json          → agent card (tier 0)
 *   POST /tasks/send                      → run skill, return JSON result
 *   POST /tasks/sendSubscribe             → run skill, return SSE stream
 *   POST /tasks/:id/cancel               → cancel a running task
 *   GET  /tasks/:id                       → task status
 *
 * Client (_put):
 *   RQ envelope  → POST /tasks/send    (await result → synthetic RS → _receive)
 *   OW envelope  → POST /tasks/send    (fire-and-forget)
 *   CX envelope  → POST /tasks/:id/cancel
 *
 * A2ATransport is registered with agent.useSecurityLayer(new A2ATLSLayer(...))
 * so that encrypt/decryptAndVerify are pass-throughs (auth lives in HTTP headers).
 */
import { createServer }                       from 'node:http';
import { readFile, stat }                      from 'node:fs/promises';
import { extname, join, resolve as resolvePath } from 'node:path';
import { Transport }        from '../transport/Transport.js';
import { AgentCardBuilder } from './AgentCardBuilder.js';
import { Parts }            from '../Parts.js';
import { genId, P }         from '../Envelope.js';

// `node:http` / `node:fs/promises` / `node:path` are eager imports —
// basis's vite.config aliases each to a browser-safe stub that
// throws if called, so importing them at module load is browser-safe
// (the previous `await import(...)` lazy-loads were a workaround for an
// older empty-shim setup; see cleanup).

const isAsyncGen = x => x && typeof x[Symbol.asyncIterator] === 'function';

// Minimal MIME table for the optional staticDir fallback (Phase 7).
const STATIC_MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
});

/**
 * HTTP transport for the A2A protocol. When a `port` is given it runs a Node HTTP
 * server for inbound tasks (agent card, /tasks/send, SSE subscribe, cancel, status,
 * optional static-file serving); as a client it maps outbound RQ/OW/CX envelopes to
 * the peer's A2A endpoints. Pair with A2ATLSLayer so envelope crypto is a pass-through
 * (authentication lives in the HTTP layer).
 */
export class A2ATransport extends Transport {
  #agent;
  #port;
  #host;
  #baseUrl;
  #a2aTLSLayer;
  #staticDir;
  #indexFile;
  #extraStaticFiles;
  #server = null;

  /**
   * @param {object} opts
   * @param {import('../Agent.js').Agent}        opts.agent
   * @param {number}                             [opts.port]     — HTTP server port
   * @param {string}                             [opts.host]     — bind interface (e.g. '127.0.0.1' to listen on localhost only). Default: undefined → Node binds on all interfaces.
   * @param {string}                             [opts.baseUrl]  — public base URL
   * @param {import('./A2ATLSLayer.js').A2ATLSLayer} [opts.a2aTLSLayer]
   * @param {string}                             [opts.staticDir] — Optional directory served over HTTP for any path that is NOT an A2A endpoint. Used by the agent-ui substrate's `mountLocalUi` to ship a per-app web UI alongside the agent's A2A surface (Phase 7 H5 V2 product items).
   * @param {string}                             [opts.indexFile='index.html'] — File served when the requested path is `/` (only when `staticDir` is set).
   * @param {Record<string, string|Uint8Array>}  [opts.extraStaticFiles] — Optional in-memory virtual files served alongside `staticDir`. Keys are URL paths (e.g. `/groups.json`); values are the content. Checked BEFORE `staticDir` so virtual files override disk files at the same path. Used to surface runtime-generated state (e.g. multi-group launcher's group index) without writing to the source tree.
   */
  constructor({ agent, port = null, host = null, baseUrl = null, a2aTLSLayer = null, staticDir = null, indexFile = 'index.html', extraStaticFiles = null }) {
    const address = baseUrl ?? (port ? `http://${host ?? 'localhost'}:${port}` : 'a2a:no-server');
    super({ address });
    this.#agent            = agent;
    this.#port             = port;
    this.#host             = host;
    this.#baseUrl          = baseUrl;
    this.#a2aTLSLayer      = a2aTLSLayer;
    this.#staticDir        = staticDir;
    this.#indexFile        = indexFile;
    this.#extraStaticFiles = extraStaticFiles ?? null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  /** Actual bound port after connect() — useful when port 0 is passed. */
  get serverPort() { return this.#server?.address()?.port ?? null; }

  async connect() {
    if (this.#port === null) return;

    this.#server = createServer((req, res) => {
      this.#handleRequest(req, res).catch(err => {
        if (!res.headersSent) _jsonError(res, 500, 'internal-error', err.message);
      });
    });

    await new Promise((resolve, reject) => {
      // When host is null, Node binds on all interfaces (legacy behaviour).
      // When host is set (e.g. '127.0.0.1'), the server is reachable only
      // on that interface.
      if (this.#host) this.#server.listen(this.#port, this.#host, resolve);
      else            this.#server.listen(this.#port, resolve);
      this.#server.once('error', reject);
    });

    // Update address with the actual port when OS assigned one (port 0).
    const actualPort = this.#server.address().port;
    if (!this.#baseUrl) {
      this._setAddress(`http://${this.#host ?? 'localhost'}:${actualPort}`);
    }
  }

  async disconnect() {
    if (!this.#server) return;
    await new Promise(resolve => this.#server.close(resolve));
    this.#server = null;
  }

  // ── Outbound (_put) ────────────────────────────────────────────────────────

  /**
   * Translate an envelope to an A2A HTTP call.
   * `to` is the remote agent's base URL.
   */
  async _put(to, envelope) {
    const base = to.replace(/\/$/, '');

    switch (envelope._p) {
      case P.RQ:
        await this.#putRequest(base, envelope);
        break;
      case P.OW:
        await this.#putOneWay(base, envelope);
        break;
      case P.CX:
        await this.#putCancel(base, envelope);
        break;
      default:
        // Other pattern codes are not meaningful for A2A — silently drop.
        break;
    }
  }

  // ── Server request router ─────────────────────────────────────────────────

  async #handleRequest(req, res) {
    const url = new URL(req.url, 'http://x');
    const { method, pathname } = { method: req.method, pathname: url.pathname };

    if (method === 'GET' && pathname === '/.well-known/agent.json') {
      return this.#serveCard(req, res);
    }
    if (method === 'POST' && pathname === '/tasks/send') {
      return this.#handleInboundTask(req, res, false);
    }
    if (method === 'POST' && pathname === '/tasks/sendSubscribe') {
      return this.#handleInboundTask(req, res, true);
    }

    const cancelMatch = pathname.match(/^\/tasks\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancelMatch) {
      return this.#handleCancel(req, res, cancelMatch[1]);
    }

    const taskMatch = pathname.match(/^\/tasks\/([^/]+)$/);
    if (method === 'GET' && taskMatch) {
      return this.#handleTaskStatus(req, res, taskMatch[1]);
    }

    // Static-file fallback (additive Phase 7 — used by agent-ui's
    // `mountLocalUi({staticDir})` to ship a per-app web UI alongside the
    // A2A surface). Restricted to GET; same path-traversal hardening
    // pattern as the relay's static server. In-memory `extraStaticFiles`
    // are checked first so the launcher can overlay runtime-generated
    // resources (e.g. /groups.json) without writing to the source tree.
    if (method === 'GET') {
      if (this.#extraStaticFiles) {
        const served = this.#tryServeExtra(pathname, res);
        if (served) return;
      }
      if (this.#staticDir) {
        const served = await this.#tryServeStatic(pathname, res);
        if (served) return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  #tryServeExtra(pathname, res) {
    const v = this.#extraStaticFiles[pathname];
    if (v == null) return false;
    let body, mime;
    if (typeof v === 'string') {
      body = v;
      mime = pathname.endsWith('.json') ? 'application/json; charset=utf-8'
           : pathname.endsWith('.html') ? 'text/html; charset=utf-8'
           : pathname.endsWith('.js')   ? 'application/javascript; charset=utf-8'
           : pathname.endsWith('.css')  ? 'text/css; charset=utf-8'
           : 'text/plain; charset=utf-8';
    } else {
      body = v;
      mime = 'application/octet-stream';
    }
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(body);
    return true;
  }

  async #tryServeStatic(pathname, res) {
    let p = pathname;
    if (p === '/' || p === '') p = '/' + this.#indexFile;
    const rootAbs = resolvePath(this.#staticDir);
    const filePath = resolvePath(join(rootAbs, p));
    if (!filePath.startsWith(rootAbs)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return true;
    }
    try {
      const s = await stat(filePath);
      if (s.isDirectory()) return false;   // fall through to 404
      const data = await readFile(filePath);
      const mime = STATIC_MIME[extname(filePath)] ?? 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type':  mime,
        'Cache-Control': 'no-cache',
      });
      res.end(data);
      return true;
    } catch {
      return false;
    }
  }

  // ── Server handlers ───────────────────────────────────────────────────────

  async #serveCard(req, res) {
    const { tier } = this.#a2aTLSLayer
      ? await this.#a2aTLSLayer.validateInbound(req)
      : { tier: 0 };

    const builder = new AgentCardBuilder({
      agent:  this.#agent,
      config: { url: this.#baseUrl ?? undefined },
    });
    const card = builder.build(tier);
    _json(res, 200, card);
  }

  async #handleInboundTask(req, res, streaming) {
    // Auth
    const { tier, claims, peerId } = this.#a2aTLSLayer
      ? await this.#a2aTLSLayer.validateInbound(req)
      : { tier: 0, claims: null, peerId: null };

    // Parse body
    const rawBody = await _readBody(req);
    let body;
    try { body = JSON.parse(rawBody); }
    catch { return _jsonError(res, 400, 'invalid-json', 'Request body must be JSON'); }

    const { id: taskId = genId(), skillId, message } = body;
    const parts = message?.parts ?? [];

    // Skill lookup
    const skill = this.#agent.skills.get(skillId);
    if (!skill || !skill.enabled) {
      return _jsonError(res, 404, 'unknown-skill',
        skill ? `Skill "${skillId}" is disabled` : `Unknown skill: "${skillId}"`);
    }

    // Policy check (using A2A-aware path when available)
    if (this.#agent.policyEngine) {
      try {
        // Use checkA2AInbound if defined, else fall back to checkInbound with fake pubKey.
        const pe = this.#agent.policyEngine;
        if (typeof pe.checkA2AInbound === 'function') {
          await pe.checkA2AInbound({ claims, peerUrl: peerId, skillId });
        } else {
          await pe.checkInbound({
            peerPubKey:  peerId ?? `a2a:${taskId}`,
            skillId,
            action:      'call',
          });
        }
      } catch (err) {
        return _jsonError(res, 403, err.code ?? 'policy-denied', err.message);
      }
    }

    const ctx = {
      parts,
      from:    peerId,
      taskId,
      agent:   this.#agent,
      tier,
      claims,
      signal:  null,
    };

    if (!streaming) {
      await this.#runTaskSync(ctx, skill, taskId, res);
    } else {
      await this.#runTaskSSE(ctx, skill, taskId, res);
    }
  }

  async #runTaskSync(ctx, skill, taskId, res) {
    let result;
    try {
      result = skill.handler(ctx);
      if (isAsyncGen(result)) {
        // Collect generator output into a single response.
        const collected = [];
        for await (const chunk of result) {
          const p = Array.isArray(chunk) ? chunk : Parts.wrap(chunk);
          collected.push(...p);
        }
        result = collected;
      } else {
        result = await result;
      }
    } catch (err) {
      if (err?.name === 'InputRequired') {
        return _json(res, 200, {
          id:     taskId,
          status: 'input-required',
          parts:  err.parts ?? [],
        });
      }
      return _json(res, 200, {
        id:     taskId,
        status: 'failed',
        error:  { code: err.code ?? 'handler-error', message: err.message },
      });
    }

    const outParts = result == null ? []
      : Array.isArray(result)       ? result
      : Parts.wrap(result);

    _json(res, 200, {
      id:        taskId,
      status:    'completed',
      artifacts: [{ name: 'result', parts: outParts }],
    });
  }

  async #runTaskSSE(ctx, skill, taskId, res) {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });

    const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
      let result = skill.handler(ctx);

      if (isAsyncGen(result)) {
        for await (const chunk of result) {
          const p = Array.isArray(chunk) ? chunk : Parts.wrap(chunk);
          send({ type: 'chunk', parts: p });
        }
      } else {
        result = await result;
        const p = result == null ? [] : Array.isArray(result) ? result : Parts.wrap(result);
        if (p.length) send({ type: 'chunk', parts: p, final: true });
      }

      send({ type: 'done', id: taskId, status: 'completed' });
    } catch (err) {
      if (err?.name === 'InputRequired') {
        send({ type: 'input-required', id: taskId, parts: err.parts ?? [] });
      } else {
        send({ type: 'error', id: taskId, error: { code: err.code ?? 'handler-error', message: err.message } });
      }
    }

    res.end();
  }

  #handleCancel(req, res, taskId) {
    const task = this.#agent.stateManager.getTask(taskId);
    if (task?.cancel) task.cancel().catch(() => {});
    const ctrl = this.#agent.stateManager.getTask(`abort:${taskId}`);
    if (ctrl?.controller) ctrl.controller.abort();
    _json(res, 200, { id: taskId, status: 'cancelled' });
  }

  #handleTaskStatus(req, res, taskId) {
    const task = this.#agent.stateManager.getTask(taskId);
    if (!task) return _jsonError(res, 404, 'not-found', `Task not found: ${taskId}`);
    _json(res, 200, { id: taskId, status: task.state ?? 'unknown' });
  }

  // ── Client helpers ────────────────────────────────────────────────────────

  async #putRequest(base, envelope) {
    const { taskId, skillId, parts = [] } = envelope.payload ?? {};
    const body = {
      id:      taskId ?? genId(),
      skillId,
      message: { role: 'user', parts },
    };

    let init = {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    };
    if (this.#a2aTLSLayer) {
      init = await this.#a2aTLSLayer.wrapOutbound(base, init);
    }

    let result;
    try {
      const resp = await fetch(`${base}/tasks/send`, init);
      result = await resp.json();
    } catch (err) {
      // Synthesise a failed RS so pending promise rejects cleanly.
      result = { id: body.id, status: 'failed', error: { message: err.message } };
    }

    const rsParts = result.artifacts?.[0]?.parts ?? result.result?.parts ?? [];
    const rsPayload = result.status === 'completed'
      ? { type: 'task-result', taskId: result.id, status: 'completed', parts: rsParts }
      : { type: 'task-result', taskId: result.id, status: 'failed',
          error: result.error?.message ?? result.error ?? 'Unknown error', parts: [] };

    // Synthetic RS envelope — resolves the pending promise in Transport._receive.
    this._receive({
      _v: 1, _p: P.RS, _id: genId(), _re: envelope._id,
      _from: base, _to: this.address, _topic: null, _ts: Date.now(), _sig: null,
      payload: rsPayload,
    });
  }

  async #putOneWay(base, envelope) {
    const { taskId, skillId, parts = [] } = envelope.payload ?? {};
    const body = {
      id:      taskId ?? genId(),
      skillId,
      message: { role: 'user', parts },
    };
    let init = {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    };
    if (this.#a2aTLSLayer) init = await this.#a2aTLSLayer.wrapOutbound(base, init);
    fetch(`${base}/tasks/send`, init).catch(() => {});
  }

  async #putCancel(base, envelope) {
    const { taskId } = envelope.payload ?? {};
    if (!taskId) return;
    let init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
    if (this.#a2aTLSLayer) init = await this.#a2aTLSLayer.wrapOutbound(base, init);
    fetch(`${base}/tasks/${taskId}/cancel`, init).catch(() => {});
  }
}

// ── Shared HTTP helpers ───────────────────────────────────────────────────────

function _json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function _jsonError(res, status, code, message) {
  _json(res, status, { error: { code, message } });
}

function _readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
