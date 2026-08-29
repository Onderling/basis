/**
 * The mobile receipt sender must send through a seam that EXISTS, and carry the circle scope.
 *
 * Until 2026-08-29 it called `bundleRef.current.sendPeer(to, payload)` — a method the bundle never had —
 * so every receipt was rejected with "no peer send yet" and no sender's chip ever reached `stored`. The
 * promise resolved, nothing threw, and the app looked fine. `src/screens/**` and App.js have no runtime
 * coverage (docs/agent-notes-known-gotchas.md), which is why this guard reads the source: the send must
 * name the agent's `sendPeerMessage` and pass the options through (the circle scope rides in them).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, '../App.js'), 'utf8');

function receiptSenderBlock() {
  const start = SRC.indexOf('makeReceiptSender({');
  if (start < 0) return null;
  const end = SRC.indexOf('});', start);
  return end < 0 ? null : SRC.slice(start, end);
}

describe('the mobile receipt sender', () => {
  it('exists', () => { expect(receiptSenderBlock()).not.toBeNull(); });
  it('sends through the agent\'s sendPeerMessage — a seam the bundle actually has', () => {
    expect(receiptSenderBlock()).toMatch(/agent\??\.sendPeerMessage\(/);
    expect(receiptSenderBlock(), 'the bundle has no `sendPeer`; calling it rejects every receipt silently').not.toMatch(/\.sendPeer\(/);
  });
  it('passes the send options through, so the receipt carries its circle scope', () => {
    expect(receiptSenderBlock()).toMatch(/sendPeerMessage\(\s*to,\s*payload,\s*opts\s*\)/);
  });
});
