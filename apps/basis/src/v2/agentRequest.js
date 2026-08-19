/**
 * basis v2 — agent-add admin approval.
 *
 * When the circle's `agents` axis is `admin-approval`, any member trying
 * to add an LLM agent participant must wait for admin approval first.
 * Design shows the request card: "Pieter wil 'notulist'
 * toevoegen aan Selwerd" with Who / What it does / Access details + a
 * [Goedkeur] / [Weiger] / [Asks…] row.  On unanimous approve, the
 * agent joins; on any reject, the request closes.
 *
 * Mirrors the multi-admin consensus shape: pure orchestrator +
 * pluggable IO-backed store + persisted requests.  Cross-device
 * delivery (NKN fan-out + receive handler) is the follow-up.
 */

/* ──────────────────────────────────────────────────────────────────
 * Pure orchestrator.
 * ────────────────────────────────────────────────────────────────── */

/**
 * Decide whether an agent-add needs admin approval for `policy`.  Maps
 * the `agents` axis ('yes' | 'admin-approval' | 'no') to a gate:
 *
 *   - 'yes'             → no gate, agent joins immediately
 *   - 'admin-approval'  → request enters the queue
 *   - 'no'              → blocked outright (no request even created)
 *
 * @param {object|null} policy
 * @returns {'allow'|'gate'|'block'}
 */
export function shouldGateAgentJoin(policy) {
  const v = policy && typeof policy === 'object' ? policy.agents : null;
  if (v === 'yes') return 'allow';
  if (v === 'admin-approval') return 'gate';
  return 'block';
}

/**
 * Build an agent-add request.  When the circle's `agents` axis is
 * `admin-approval` AND it has ≥1 admin, the request enters the queue;
 * otherwise it returns ready/blocked immediately. Per, the
 * requester implicitly approves (an admin proposing a new agent
 * doesn't have to approve their own request again).
 *
 * @param {object} args
 * @param {string} args.circleId
 * @param {string} [args.requesterId]    webid of the proposer (proposer's implicit approval if they're an admin)
 * @param {object} args.agent            { webid, name, kind?, capabilities?, accessLevels? }
 * @param {object} args.policy           must include `agents` axis + `admins` array
 * @param {() => number} [args.now=Date.now]
 * @returns {{
 *   id: string,
 *   circleId: string,
 *   agent: object,
 *   requestedBy: string|null,
 *   requestedAt: number,
 *   requiredApprovers: string[],
 *   approvals: string[],
 *   rejections: string[],
 *   status: 'ready'|'pending'|'rejected'|'blocked',
 * }}
 */
export function buildAgentRequest({ circleId, requesterId, agent, policy, now = Date.now } = {}) {
  const gate = shouldGateAgentJoin(policy);
  const admins = Array.isArray(policy?.admins) ? policy.admins : [];
  const ts = typeof now === 'function' ? now() : Date.now();

  // Requester implicitly approves IF they are themselves an admin.
  const seedApprovals = (typeof requesterId === 'string' && admins.includes(requesterId))
    ? [requesterId]
    : [];

  const base = {
    id:                `agreq-${ts.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    circleId:          typeof circleId === 'string' ? circleId : null,
    agent:             normalizeAgent(agent),
    requestedBy:       typeof requesterId === 'string' && requesterId ? requesterId : null,
    requestedAt:       ts,
    requiredApprovers: gate === 'gate' ? [...admins] : [],
    approvals:         seedApprovals,
    rejections:        [],
    status:            'pending',
  };

  if (gate === 'allow') return { ...base, status: 'ready' };
  if (gate === 'block') return { ...base, status: 'blocked' };

  // gate === 'gate': decide ready vs pending from the seed approvals.
  return {
    ...base,
    status: isComplete(base.requiredApprovers, base.approvals) ? 'ready' : 'pending',
  };
}

/**
 * Record an admin's approval.  Idempotent; flips to 'ready' once every
 * required approver is in.  Already-rejected requests stay rejected.
 *
 * @param {object} request
 * @param {string} approver
 * @returns {object}
 */
export function approveAgentRequest(request, approver) {
  if (!request) return request;
  if (request.status === 'rejected' || request.status === 'blocked') return request;
  if (request.status === 'ready') return request;
  if (typeof approver !== 'string' || !approver) return request;
  const approvals = request.approvals.includes(approver)
    ? request.approvals
    : [...request.approvals, approver];
  return {
    ...request,
    approvals,
    status: isComplete(request.requiredApprovers, approvals) ? 'ready' : 'pending',
  };
}

/**
 * Record an admin's rejection.  Any single reject flips the request
 * to 'rejected' (per: a checkpoint, not a tally).
 */
export function rejectAgentRequest(request, rejecter) {
  if (!request) return request;
  if (request.status === 'ready' || request.status === 'rejected' || request.status === 'blocked') return request;
  if (typeof rejecter !== 'string' || !rejecter) return request;
  const rejections = request.rejections.includes(rejecter)
    ? request.rejections
    : [...request.rejections, rejecter];
  return { ...request, rejections, status: 'rejected' };
}

/** Required approvers who haven't approved (and haven't rejected) yet. */
export function pendingAgentApprovers(request) {
  const required = request?.requiredApprovers ?? [];
  const approvals = request?.approvals ?? [];
  return required.filter((a) => !approvals.includes(a));
}

function isComplete(required, approvals) {
  return Array.isArray(required) && required.every((a) => approvals.includes(a));
}

function normalizeAgent(raw = {}) {
  const a = raw && typeof raw === 'object' ? raw : {};
  return {
    webid:        typeof a.webid === 'string'        ? a.webid        : null,
    name:         typeof a.name === 'string'         ? a.name         : null,
    kind:         typeof a.kind === 'string'         ? a.kind         : null,
    capabilities: Array.isArray(a.capabilities)      ? a.capabilities : [],
    accessLevels: Array.isArray(a.accessLevels)      ? a.accessLevels : [],
  };
}

/* ──────────────────────────────────────────────────────────────────
 * Persistence store — same IO contract as the proposal store.
 * ────────────────────────────────────────────────────────────────── */

const STORE_KEY = 'cc.agentRequests';

export function createAgentRequestStore({ io, storeKey = STORE_KEY } = {}) {
  if (!io || typeof io.load !== 'function' || typeof io.save !== 'function') {
    throw new TypeError('createAgentRequestStore: io must provide load + save');
  }

  async function readAll() {
    const raw = await io.load(storeKey);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }
  async function writeAll(map) { await io.save(storeKey, map); }

  async function listForCircle(circleId) {
    const all = await readAll();
    const list = Array.isArray(all[circleId]) ? all[circleId] : [];
    return [...list].sort((a, b) => (a.requestedAt ?? 0) - (b.requestedAt ?? 0));
  }

  async function save(request) {
    if (!request || !request.id || !request.circleId) {
      throw new TypeError('save: request needs `id` and `circleId`');
    }
    const all = await readAll();
    const list = Array.isArray(all[request.circleId]) ? all[request.circleId] : [];
    const idx = list.findIndex((r) => r.id === request.id);
    if (idx >= 0) list[idx] = request;
    else list.push(request);
    all[request.circleId] = list;
    await writeAll(all);
  }

  async function remove(id) {
    const all = await readAll();
    let touched = false;
    for (const cid of Object.keys(all)) {
      const list = all[cid];
      if (!Array.isArray(list)) continue;
      const next = list.filter((r) => r.id !== id);
      if (next.length !== list.length) { all[cid] = next; touched = true; }
      if (next.length === 0) delete all[cid];
    }
    if (touched) await writeAll(all);
  }

  async function updateOne(id, fn) {
    if (typeof fn !== 'function') return null;
    const all = await readAll();
    for (const cid of Object.keys(all)) {
      const list = Array.isArray(all[cid]) ? all[cid] : [];
      const idx = list.findIndex((r) => r.id === id);
      if (idx >= 0) {
        const next = fn(list[idx]);
        if (!next) return null;
        list[idx] = next;
        all[cid] = list;
        await writeAll(all);
        return next;
      }
    }
    return null;
  }

  async function countPending(circleId) {
    const list = await listForCircle(circleId);
    return list.filter((r) => r.status === 'pending').length;
  }

  return { listForCircle, save, remove, updateOne, countPending };
}

export const AGENT_REQUEST_STORE_KEY = STORE_KEY;
