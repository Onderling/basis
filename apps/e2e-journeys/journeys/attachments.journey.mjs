// J-attachments: sharing something WITH a file — and the plaintext gate that protects it.
//
// Frits described the corridor he cares about as "agents create tasks, share them in circles with
// all kinds of attachments". The coverage survey found attachments have never crossed a real
// transport in any test: there is DOM coverage, a hermetic sealed-media test, and nothing that puts
// an attachment on a wire between people.
//
// Two things are worth proving here, and they are different in kind:
//
//   1. THE GATE — an attachment must be sealed. Plaintext bytes and `data:` thumbnails are refused
//      at the write, not hidden by a UI that happens not to offer them. This is the enforceability
//      test applied to files: could a different app version post the bytes anyway?
//   2. THE CORRIDOR — a message carrying a media pointer reaches the other people with the pointer
//      intact, and the wire carries no plaintext.
//
// Runs in the app composition, so the chat lane is the real one (signed, verified at each rail).
import { checker } from './_util.mjs';
import { bootAppCircle, untilTrue, sendCircleChat } from './_app.mjs';

export const name = 'J-attachments (a file travels with the message — and plaintext is refused)';

const CIRCLE = 'e2e-attachments';

/** A well-formed SEALED attachment: a blob ref plus the sealed marker the validator demands. */
const sealedAttachment = () => ({
  type: 'media',
  mime: 'image/jpeg',
  source: { type: 'blob', ref: 'blob://circle-e2e/att-1', enc: { sealed: true } },
});

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;

  try {
    circle = await bootAppCircle({ relayUrl, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'] });
    const [anne, bram, cato] = circle.people;
    const post = (node, args) => node.agent.callSkill('stoop', 'postRequest', args);

    // ── 1. THE GATE — plaintext is refused at the act ─────────────────────────────────────────────
    const withBytes = await post(anne, {
      text: 'foto van de stoep', intent: 'ask',
      attachments: [{ type: 'media', mime: 'image/jpeg', dataB64: 'iVBORw0KGgo=' }],
    });
    check('inline plaintext BYTES are refused', !!withBytes?.error,
      JSON.stringify(withBytes)?.slice(0, 140));

    const withDataThumb = await post(anne, {
      text: 'foto met thumbnail', intent: 'ask',
      attachments: [{
        type: 'media', mime: 'image/jpeg', thumbnail: 'data:image/jpeg;base64,iVBORw0KGgo=',
        source: { type: 'blob', ref: 'blob://circle-e2e/att-2', enc: { sealed: true } },
      }],
    });
    check('a `data:` THUMBNAIL is refused too — the small leak is still a leak',
      !!withDataThumb?.error, JSON.stringify(withDataThumb)?.slice(0, 140));

    const unsealed = await post(anne, {
      text: 'onversleutelde bijlage', intent: 'ask',
      attachments: [{ type: 'media', mime: 'image/jpeg', source: { type: 'blob', ref: 'blob://circle-e2e/att-3' } }],
    });
    check('an UNSEALED blob reference is refused', !!unsealed?.error, JSON.stringify(unsealed)?.slice(0, 140));

    const badRef = await post(anne, {
      text: 'bijlage zonder sleutel', intent: 'ask',
      attachments: [{ type: 'media', mime: 'image/jpeg', source: { type: 'blob', ref: 'blob://', enc: { sealed: true } } }],
    });
    check('a blob ref with NO bucket key is refused — a reader could never open it',
      !!badRef?.error, JSON.stringify(badRef)?.slice(0, 140));

    // ── 2. A well-formed sealed attachment ────────────────────────────────────────────────────────
    // Either it posts, or it says the cache is missing — both are informative, and the second ties
    // this domain to the pod-medium finding rather than looking like an attachment bug.
    const sealed = await post(anne, { text: 'de stoep, netjes', intent: 'ask', attachments: [sealedAttachment()] });
    const needsCache = String(sealed?.error ?? '').includes('need-cache');
    check('a properly SEALED attachment is accepted (or names the missing cache, F-007\'s neighbour)',
      !sealed?.error || needsCache, JSON.stringify(sealed)?.slice(0, 160));
    if (needsCache) {
      check('[F-009] posting with an attachment requires a cache medium this composition has no way to provide',
        false, 'attachments are unreachable wherever the pod medium is — see F-007');
    }

    // ── 3. THE CORRIDOR — a message carrying a media pointer reaches the others ───────────────────
    const media = {
      kind: 'media-card',
      pointer: { type: 'blob', ref: 'blob://circle-e2e/att-1' },
      snapshot: { source: { type: 'blob', ref: 'blob://circle-e2e/att-1', enc: { sealed: true } } },
    };
    // Send it the way a shell does — append the signed entry AND fan it.
    const sent = await sendCircleChat(anne, { groupId: CIRCLE, msgId: 'att-1', text: 'hier is de foto', media });
    check('the message with a media card is signed and sent', !sent?.error, JSON.stringify(sent)?.slice(0, 140));

    // What actually leaves the device is the WHITELISTED wire payload — assert on the statement.
    const own = anne.chatRail.storedStatements(CIRCLE).find((st) => st?.body?.subject === 'att-1');
    const wire = JSON.stringify(own?.body?.payload ?? {});
    check('the wire carries the media POINTER', wire.includes('blob://circle-e2e/att-1'));
    check('the wire carries no plaintext bytes', !wire.includes('dataB64') && !wire.includes('data:image'));

    // And it lands, verified, on the other people's devices.
    for (const [who, node] of [['the second person', bram], ['the third person', cato]]) {
      const landed = await untilTrue(async () => node.chatRail.storedStatements(CIRCLE)
        .some((s) => s?.body?.subject === 'att-1'));
      check(`${who} receives the message carrying the attachment`, landed);
    }
  } catch (err) {
    check('the attachment corridor completed', false, String(err?.message ?? err).slice(0, 200));
  } finally {
    await circle?.close?.().catch(() => {});
  }
  return results;
}
