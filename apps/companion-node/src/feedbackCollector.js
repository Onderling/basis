// Signed-contribution collector — a companion-node capability (surface of the user-hostable acting
// layer, plans/NOTE-companion-node.md). It lets a NO-LOGIN participant device hand a SIGNED record to
// the companion, which — holding the central pod's write credential — files it into the project's
// central pod under the participant's PSEUDONYM (their agent public key). The participant never logs
// in to the central pod; the companion is the authenticated server-side writer.
//
// Boundary: this is the ONDERLING half of feedback's central-pod route. It is deliberately BLIND to the
// contribution's meaning — an opaque JSON blob with a `{sig, pubKey}` that rides along in the body.
// Signature validity is enforced by the feedback AGGREGATION at read time (it re-checks every stored
// signature and drops forged/unsigned/sybil records — see feedback css-central-pod.js), so a dishonest
// writer gains nothing; the collector only requires a record to CLAIM a key + signature and files it
// under that key. The stored shape MATCHES CssCentralPod so the existing aggregation reads it verbatim.
//
// The pseudonym = the agent public key the record is signed with. It is NOT a real-world identity, so
// the central pod stays pseudonymous; cross-project unlinkability (per-project keys) is a later refinement.
import http from 'node:http';
import { createHash } from 'node:crypto';

/**
 * @param {object} o
 * @param {(url:string, init?:object)=>Promise<Response>} o.authedFetch  central-pod write credential (a DPoP fetch)
 * @param {string} o.podBase       the project pod root, e.g. http://localhost:3002/project/
 * @param {number} [o.port=0]      0 → OS-assigned
 * @param {string} [o.host='127.0.0.1']
 * @param {string} [o.allowOrigin='*']  CORS origin (the participant app posts cross-origin)
 * @returns {Promise<{server,port,url,root,stop}>}
 */
export function startFeedbackCollector({ authedFetch, podBase, port = 0, host = '127.0.0.1', allowOrigin = '*' }) {
  if (typeof authedFetch !== 'function') throw new Error('startFeedbackCollector: authedFetch is required');
  if (!podBase) throw new Error('startFeedbackCollector: podBase is required');
  const base = podBase.endsWith('/') ? podBase : `${podBase}/`;
  const root = `${base}central/`;
  // A tidy, stable path slug from the pseudonym key (the record's `participant` field is the source of
  // truth for aggregation/withdraw; the path slug is cosmetic + keeps long keys out of the URL).
  const slug = (participant) => createHash('sha256').update(String(participant)).digest('hex').slice(0, 24);
  // The verified-summary id is `<participant>:summary:<round>` (feedback-pipeline releaseVerifiedSummary), so
  // the round # rides in the id — parse it for the PM platform without changing the signed contribution.
  const roundFromId = (id) => { const m = /:summary:(\d+)$/.exec(String(id || '')); return m ? Number(m[1]) : null; };

  const cors = (res) => {
    res.setHeader('access-control-allow-origin', allowOrigin);
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  };
  const json = (res, status, body) => { cors(res); res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });
  const ensureContainer = (uri) => authedFetch(uri, {
    method: 'PUT', headers: { 'content-type': 'text/turtle', link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' },
  }).catch(() => {});

  // Verify-summary rounds (the PM's "collect" trigger). The lead writes a round REQUEST here; the
  // participant device polls GET /rounds and produces + releases its own summary. In memory: rounds are
  // not sensitive (a request, not an extraction — see round-control.js). Persist to the pod later if needed.
  const rounds = [];
  // Read one participant's own container of records (for pendingRoundsFor's already-verified check — a
  // participant may only query their OWN pseudonym, so this leaks nothing across participants).
  const listContainer = async (uri) => {
    const r = await authedFetch(uri, { headers: { accept: 'text/turtle' } });
    if (!r.ok) return [];
    const ttl = await r.text(); const out = [];
    for (const m of ttl.matchAll(/<([^>]+)>/g)) {
      let href; try { href = new URL(m[1], uri).href; } catch { continue; }
      if (!href.endsWith('.json') || !href.startsWith(uri)) continue;
      const rr = await authedFetch(href); if (rr.status === 200) out.push(await rr.json());
    }
    return out;
  };

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
    let url; try { url = new URL(req.url, `http://${host}`); } catch { return json(res, 400, { error: 'bad-request' }); }
    const p = url.pathname;

    if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true, root });

    if (req.method === 'POST' && p === '/collect') {
      const { participant, contribution, meta } = await readBody(req);
      if (!contribution?.id) return json(res, 400, { error: 'contribution.id required' });
      if (!meta?.pubKey || !meta?.sig) return json(res, 401, { error: 'signed record required (meta.pubKey + meta.sig)' });
      // The pseudonym IS the participant the record was signed over (the agent public key). Aggregation
      // reconstructs the canonical form from this field, so it must be stored verbatim.
      const who = participant || meta.pubKey;
      const container = `${root}${slug(who)}/`;
      const target = `${container}${encodeURIComponent(contribution.id)}.json`;
      // Same body shape CssCentralPod writes → the existing aggregation/verify reads it unchanged. PLUS coarse
      // metadata for the PM platform, stamped SERVER-SIDE and OUTSIDE the contribution (so it is not part of the
      // signed canonical — adding it cannot break signature verification): `round` (parsed from the summary id)
      // and `receivedDate` = DATE-ONLY (no time-of-day → a useful "when" without a fingerprinting-precise stamp).
      const round = roundFromId(contribution.id);
      const receivedDate = new Date().toISOString().slice(0, 10);
      const body = { participant: who, contribution, status: 'submitted', sig: meta.sig, pubKey: meta.pubKey,
        ...(round != null ? { round } : {}), receivedDate };
      await ensureContainer(root);
      await ensureContainer(container);
      if ((await authedFetch(target)).status === 200) return json(res, 409, { error: `duplicate contribution id: ${contribution.id}` });
      const r = await authedFetch(target, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) return json(res, 502, { error: `pod write failed: HTTP ${r.status}` });
      return json(res, 200, { ok: true, pseudonym: slug(who), url: target });
    }

    if (req.method === 'POST' && p === '/withdraw') {
      const { participant, id, meta } = await readBody(req);
      const who = participant || meta?.pubKey;
      if (!who || !id) return json(res, 400, { error: 'participant/pubKey + id required' });
      const target = `${root}${slug(who)}/${encodeURIComponent(id)}.json`;
      const r = await authedFetch(target, { method: 'DELETE' });
      return json(res, 200, { ok: r.ok || r.status === 404 });
    }

    // PM opens a verification round (idempotent per {projectId, round}).
    if (req.method === 'POST' && p === '/round/open') {
      const { projectId, round, message, deadline, openedBy } = await readBody(req);
      if (!projectId || round == null) return json(res, 400, { error: 'projectId + round required' });
      const existing = rounds.find((r) => r.projectId === projectId && r.round === round);
      if (existing) return json(res, 200, existing);
      const req0 = { projectId, round, openedAt: new Date().toISOString(), ...(message ? { message } : {}), ...(deadline ? { deadline } : {}), ...(openedBy ? { openedBy } : {}) };
      rounds.push(req0);
      return json(res, 200, req0);
    }
    // Participants poll the open rounds for a project.
    if (req.method === 'GET' && p === '/rounds') {
      const projectId = url.searchParams.get('projectId');
      return json(res, 200, rounds.filter((r) => !projectId || r.projectId === projectId));
    }
    // A participant reads their OWN released records (to know which rounds they've already verified).
    if (req.method === 'GET' && p === '/mine') {
      const who = url.searchParams.get('participant');
      if (!who) return json(res, 400, { error: 'participant required' });
      return json(res, 200, await listContainer(`${root}${slug(who)}/`));
    }

    return json(res, 404, { error: 'not-found' });
  });

  return new Promise((resolve) => server.listen(port, host, () => {
    const boundPort = server.address().port;
    resolve({ server, port: boundPort, url: `http://${host}:${boundPort}`, root, stop: () => new Promise((r) => server.close(() => r())) });
  }));
}
