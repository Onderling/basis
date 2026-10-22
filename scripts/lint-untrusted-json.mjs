/**
 * lint-untrusted-json — JSON that someone else wrote is parsed with `parseUntrustedJson` (@onderling/core).
 *
 * What this protects: `JSON.parse` keeps `"__proto__"` as an ordinary own key, and the first merge of the result
 * (`Object.assign`, a key-copy loop) then sets the target's PROTOTYPE — fields that read as present without being there.
 * Found 2026-10-22 by the fuzz harness: a hand-made contact card's extra fields set the decoded card's prototype, and
 * `card.bot` read true. `parseUntrustedJson` refuses a prototype key at the parse, so no decoder downstream has to
 * remember. That fix decays the usual way: the next edit to one of these decoders writes `JSON.parse` again, and
 * nothing fails. So in the files below — every decoder of a peer's payload, a frame, a scanned or pasted code, a file a
 * person picks, or an item synced in from others — a bare `JSON.parse(` is red. (`JSON.parse(JSON.stringify(…))`, a
 * deep copy of our own object, is not a parse of anyone's input and is allowed.)
 *
 * A NEW decoder of someone else's JSON joins this list in the PR that adds it. A file that parses only this device's
 * own storage (a vault, its own outbox, its own settings) does not belong here.
 */
import { readFileSync } from 'node:fs';

const FILES = [
  // the wire: a peer's frames and payloads
  'packages/core/src/security/SecurityLayer.js',
  'packages/core/src/security/sealedForward.js',
  'packages/core/src/security/tunnelSeal.js',
  'packages/core/src/identity/personKey.js',
  'packages/core/src/protocol/SkillsPubSub.js',
  'packages/core/src/a2a/A2AAuth.js',
  'packages/core/src/permissions/CapabilityToken.js',
  'packages/core/src/permissions/PodCapabilityToken.js',
  'packages/secure-agent/src/peerChunking.js',
  'packages/secure-agent/src/claim.js',
  'packages/transports/src/RendezvousTransport.js',
  'packages/transports/src/RelayTransport.js',
  'packages/transports/src/NknTransport.js',
  'packages/transports/src/NetworkTransport.js',
  'packages/transports/src/MqttTransport.js',
  'packages/transports/src/MdnsTransport.js',
  'packages/relay/src/WsServerTransport.js',
  'packages/relay/src/server.js',
  'packages/relay/src/blobGateMount.js',
  // what other members' writes sync in, and a backup kept elsewhere
  'packages/item-store/src/ItemStore.js',
  'packages/item-store/src/CircleItemStore.js',
  'packages/item-store/src/embeds.js',
  'packages/core/src/identity/CloudBackup.js',
  'packages/core/src/Agent.js',
  // codes a person scans or pastes, cards that ride a message, files a person picks
  'apps/pinboard/src/lib/contactCard.js',
  'apps/basis/src/v2/enrollOffer.js',
  'apps/basis/src/v2/connectionPairing.js',
  'apps/basis/src/v2/identityLink.js',
  'apps/basis/src/v2/botScreens.js',
  'apps/basis/src/core/wizards/joinGroupState.js',
  'apps/basis/src/v2/registryCarrier.js',
];

/** `realAgent` parses its own vault rows too, so only its invite arguments (pasted) are held to the rule there. */
const LINES = [
  { path: 'apps/basis/src/core/agent/realAgent.js', match: /invite:\s*JSON\.parse\(/ },
];

const bad = [];
for (const path of FILES) {
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (/\bJSON\.parse\(/.test(code) && !/JSON\.parse\(JSON\.stringify\(/.test(code)) bad.push(`${path}:${i + 1}`);
  });
}
for (const { path, match } of LINES) {
  readFileSync(path, 'utf8').split('\n').forEach((line, i) => { if (match.test(line)) bad.push(`${path}:${i + 1}`); });
}

if (bad.length) {
  console.error('✖ untrusted-json: a decoder of someone else\'s JSON uses JSON.parse — use parseUntrustedJson (@onderling/core):');
  for (const b of bad) console.error(`    ${b}`);
  process.exit(1);
}
console.log(`✓ untrusted-json: ${FILES.length} decoder file(s) + the pasted-invite path parse with parseUntrustedJson.`);
