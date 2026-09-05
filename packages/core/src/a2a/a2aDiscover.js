/**
 * a2aDiscover — fetch and parse an A2A agent card from a remote URL.
 *
 * Fetches /.well-known/agent.json, validates required fields, builds an
 * A2A peer record, and upserts it into the agent's PeerGraph (if available).
 *
 * If the card contains x-onderling.pubKey + nknAddr/relayUrl, a native
 * hello upgrade is attempted transparently.
 */

/**
 * Discover an A2A agent by URL and register it as a peer.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string} url  — base URL of the remote agent (e.g. https://agent.example.com)
 * @param {object} [opts]
 * @param {import('../discovery/PeerGraph.js').PeerGraph} [opts.peerGraph]
 * @param {number}  [opts.timeout=10000]
 * @returns {Promise<object>}  — the A2A peer record that was upserted
 */
export async function discoverA2A(agent, url, opts = {}) {
  const { peerGraph = null, timeout = 10_000 } = opts;

  const cardUrl = `${url.replace(/\/$/, '')}/.well-known/agent.json`;

  let card;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const resp  = await fetch(cardUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${cardUrl}`);
    card = await resp.json();
  } catch (err) {
    throw new Error(`A2A discovery failed for ${url}: ${err.message}`);
  }

  _validateCard(card, url);

  const xd = card['x-onderling'] ?? {};

  const peerRecord = {
    type:        'a2a',
    url:         url.replace(/\/$/, ''),
    name:        card.name        ?? 'Unknown',
    description: card.description ?? '',
    skills:      (card.skills ?? []).map(_toSkillCard),
    authScheme:  _detectAuthScheme(card),
    pubKey:      xd.pubKey  ?? null,
    nknAddr:     xd.nknAddr ?? null,
    // What the agent asks of a client before a turn is sent to it — `'pre-send'` or
    // `{ mode:'pre-send', rules, placeholders }` (a redaction ruleset as data); a client that
    // honours it redacts on the sender's device. Absent → nothing asked.
    redact:      xd.redact  ?? null,
    localTrust:  null,
    lastFetched: Date.now(),
    reachable:   true,
  };

  if (peerGraph) {
    await peerGraph.upsert(peerRecord);
  }

  // Attempt native upgrade when the card carries the necessary connection info.
  if (peerRecord.pubKey && (peerRecord.nknAddr ?? xd.relayUrl)) {
    _tryNativeUpgrade(agent, peerRecord, xd).catch(() => {});
  }

  return peerRecord;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _validateCard(card, url) {
  if (typeof card !== 'object' || card === null) {
    throw new Error(`Invalid agent card from ${url}: not an object`);
  }
  if (!card.name) {
    throw new Error(`Invalid agent card from ${url}: missing 'name' field`);
  }
}

function _toSkillCard(s) {
  return {
    id:          s.id          ?? s.name ?? 'unknown',
    name:        s.name        ?? s.id   ?? 'Unknown',
    description: s.description ?? '',
    inputModes:  s.inputModes  ?? ['text/plain'],
    outputModes: s.outputModes ?? ['text/plain'],
    tags:        s.tags        ?? [],
    streaming:   s.streaming   ?? false,
  };
}

function _detectAuthScheme(card) {
  const schemes = card.authentication?.schemes ?? [];
  if (schemes.includes('Bearer')) return 'Bearer';
  return 'None';
}

async function _tryNativeUpgrade(agent, peerRecord, xd) {
  const nknAddr  = peerRecord.nknAddr;
  const relayUrl = xd.relayUrl;

  // Find a transport that can reach the peer's native address.
  const transport = agent.transport;

  const targetAddr = nknAddr ?? relayUrl;
  if (!targetAddr) return;

  try {
    await agent.hello(targetAddr, 8_000);
  } catch {
    // Native upgrade is best-effort; silently ignore failures.
  }
}
