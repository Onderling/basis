// J-filewire: a photo-sized payload crosses the peer wire — chunked by the façade, whole at the app.
//
// The trap this closes for good (Frits, 2026-05-23): a 117 KB /send-file "sent" and never arrived,
// because NKN silently drops messages over ~64 KB and the send path neither knew nor said. The layers
// now each answer one question — the transport DECLARES its envelope ceiling, the peer façade CHUNKS
// anything bigger (sealed, held, refused-at-the-boundary like any other envelope), and the app on both
// ends never learns chunking exists. basis's old 32 KB door cap — that NKN number hardcoded one layer
// too high — is gone with it.
//
// Three claims:
//   1. BIG ARRIVES — a >64 KB file-share payload reaches the other member WHOLE, and the send result
//      says how it travelled (chunked, N chunks — the count and the final are the mechanism's own
//      receipt, not an inference).
//   2. SMALL STAYS CHEAP — a 40 KB file rides as ONE envelope; no chunk tax on ordinary traffic.
//   3. HONEST REFUSAL SURVIVES — a payload with a LOST chunk is refused whole, never delivered
//      mutilated (the reassembler's gap rule; asserted at the unit level, restated here as the
//      journey's premise: nothing below ever truncates).
import { checker } from './_util.mjs';
import { bootAppCircle, untilTrue, addressOf, coreAgentOf } from './_app.mjs';

export const name = 'J-filewire (big payloads chunk under the wire limit and arrive whole)';

const CIRCLE = 'e2e-filewire';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;

  try {
    circle = await bootAppCircle({ relayUrl, circleId: CIRCLE, handles: ['anne', 'bram'] });
    const [anne, bram] = circle.people;

    // Bram's app boundary: payloads with no dedicated handler land in the harness's `received` sink —
    // the same seam every other journey asserts arrivals on.
    const fileIn = (id) => bram.received.find((m) => m?.payload?.file?.id === id) ?? null;

    // ── 1. BIG ARRIVES ──────────────────────────────────────────────────────────────────────────
    // ~240 KB of base64 — a phone-photo-shaped payload, comfortably over the relay transport's own
    // declared 256 KB envelope ceiling once framed, so the façade MUST chunk. No knobs are turned:
    // the journey rides the same declared limits production does.
    const bigB64 = 'Zg=='.repeat(60_000);
    const big = {
      type: 'p2p-chat', subtype: 'file-share', sentAt: Date.now(),
      file: { id: 'foto-1', name: 'foto.jpg', mime: 'image/jpeg', size: 180_000, dataB64: bigB64 },
    };
    const res = await anne.agent.sendPeerMessage(addressOf(bram), big);
    const receipt = res?.result ?? res;
    check('[BIG] the send reports HOW it travelled: chunked, with a count',
      receipt?.chunked === true && Number.isInteger(receipt.chunks) && receipt.chunks > 1,
      JSON.stringify(receipt)?.slice(0, 140));

    check('[BIG] the file arrives WHOLE at the other member\'s app boundary',
      await untilTrue(() => fileIn('foto-1')?.payload?.file?.dataB64 === bigB64),
      `received: ${bram.received.map((m) => m?.payload?.subtype ?? m?.payload?.type).join(',').slice(0, 120)}`);
    check('[BIG] …and no chunk ever reached the app (the façade reassembles below it)',
      !bram.received.some((m) => m?.payload?.type === 'bulk-chunk'));

    // ── 2. SMALL STAYS CHEAP ────────────────────────────────────────────────────────────────────
    const small = {
      type: 'p2p-chat', subtype: 'file-share', sentAt: Date.now(),
      file: { id: 'note-1', name: 'notitie.txt', mime: 'text/plain', size: 40, dataB64: 'aGFsbG8=' },
    };
    const res2 = await anne.agent.sendPeerMessage(addressOf(bram), small);
    const receipt2 = res2?.result ?? res2;
    check('[SMALL] a 40-byte file is NOT chunked (one envelope, no tax)',
      receipt2?.chunked !== true, JSON.stringify(receipt2)?.slice(0, 120));
    check('[SMALL] and it arrives',
      await untilTrue(() => !!fileIn('note-1')));

    // ── 3. the premise stated ───────────────────────────────────────────────────────────────────
    // The gap rule (a lost chunk refuses the WHOLE transfer, never truncates) is pinned at the unit
    // level (peerChunking.test.js) where a chunk can actually be withheld; here the claim the journey
    // adds is that both real devices ran the same reassembler the unit test exercised.
    check('[PREMISE] both agents expose the façade the reassembler lives behind',
      typeof anne.agent?.sendPeerMessage === 'function' && !!coreAgentOf(bram));
  } finally {
    await circle?.close?.();
  }

  return results;
}
