// J-attach: what the "+" offers here, and what comes back when you tap it.
//
// Frits, on the + menu: *"this was supposed to attach files, photo's, add calendar items, lists,
// tasks, whatever. It used to work previously, but apparently it broke."* It had: the menu rendered
// NOTHING in an ordinary circle, and every layer of why was individually correct — which is what makes
// it worth a journey rather than only a fix.
//
// The corridor (does a card reach the other people) is J-attachments' job. This one asks the two
// questions before that:
//
//   1. WHAT IS OFFERED HERE — the projector's entries, narrowed by the circle's own answer. An entry
//      that cannot work must not be painted (Frits, 2026-09-01: *"We should never offer functions that
//      actually don't work"*), and an entry that CAN work must not be hidden by a question about
//      something else. The bug was the second: `opAvailability` asked "is basis composed into this
//      circle" of ops that belong to the DEVICE, got the honest "no" the LLM scope is there to give,
//      and the menu — left with nothing usable — rendered nothing at all.
//   2. WHAT A TAP BECOMES — `composerReplyToStream`, the one place that decides whether an op's answer
//      is a card the circle sees or a note for the person who asked. Three doors were deciding this
//      separately and disagreeing: the typed door printed `message` and rendered a card as silence.
//
// Both are shared seams, so this drives them directly — the shells only paint what these return.
import { checker } from './_util.mjs';
import { declaredOp } from './_util.mjs';
import basisManifest from '../../basis/manifest.js';
import tasksManifest from '../../tasks-v0/manifest.js';
import { attachEntriesFor } from '../../basis/src/v2/attachEntries.js';
import { cardForCreatedItem } from '../../basis/src/v2/createdCard.js';
import { makeOpAvailability } from '../../basis/src/v2/opAvailability.js';
import { composerReplyToStream } from '../../basis/src/v2/composerReply.js';

export const name = 'J-attach (what the + offers here, and what a tap becomes)';

/** The catalogue a circle actually has: its composed apps, and never basis — the scope the bot reads. */
const circleCatalogue = (...opIds) => ({ opsById: new Map(opIds.map((id) => [id, {}])) });

/** What the composer paints — the SAME function both shells call, not a copy of its rules. */
function offeredHere({ catalogue, policy = null, wiredFilePath = false, apps = { basis: basisManifest } }) {
  return attachEntriesFor({
    manifestsByOrigin: apps,
    availability: makeOpAvailability({ catalogue, manifestsByOrigin: apps, policy }),
    mediaWired: wiredFilePath,
  }).map((e) => e.opId);
}

export async function run() {
  const { results, check } = checker();

  try {
    for (const op of ['embed', 'embed-file', 'embed-time']) await declaredOp('basis', op);

    // ── 1 · WHAT IS OFFERED ───────────────────────────────────────────────────────────────────────
    const plain = offeredHere({ catalogue: circleCatalogue('addTask', 'listOpen') });
    check('a plain circle offers the device\'s composer entries — the menu is not empty',
      plain.length > 0, plain.join(','));
    check('…including the appointment, which the composition question used to hide',
      plain.includes('embed-time'), plain.join(','));
    check('the FILE entry is left out where sealed media is not composed — not offered and refused',
      !plain.includes('embed-file'), plain.join(','));

    const withMedia = offeredHere({ catalogue: circleCatalogue('addTask'), wiredFilePath: true });
    check('…and IS offered once the circle can actually seal a file',
      withMedia.includes('embed-file'), withMedia.join(','));

    // A circle that composes NOTHING still offers them: they are this device's, not the circle's.
    const bare = offeredHere({ catalogue: circleCatalogue() });
    check('a circle that composes no apps at all still offers them — they belong to the device',
      bare.includes('embed-time'), bare.join(','));

    // The other two gates are untouched by that exemption — a capability still decides. The row shape
    // is the freedom matrix's own (`{app, atom, noun, enabled, optedOut, consequence}`), not a
    // hand-shaped `{treatment}`: a wrong-shaped row matches nothing and reads as "allowed", which is
    // how a gate can look tested and be silent.
    const withheld = (consequence) => [{
      app: 'basis', atom: 'add', noun: null, enabled: false, optedOut: false, consequence,
    }];
    const offeredWhenHidden = attachEntriesFor({
      manifestsByOrigin: { basis: basisManifest },
      availability: makeOpAvailability({
        catalogue: circleCatalogue('addTask'), manifestsByOrigin: { basis: basisManifest },
        capabilityMatrix: withheld('hidden'),
      }),
    });
    check('a member whose capability is withheld is offered nothing to attach',
      offeredWhenHidden.length === 0, offeredWhenHidden.map((e) => e.opId).join(','));

    const greyed = makeOpAvailability({
      catalogue: circleCatalogue('addTask'), manifestsByOrigin: { basis: basisManifest },
      capabilityMatrix: withheld('greyed'),
    }).of('embed-time');
    check('…and a GREYED capability greys rather than hides — the circle chose to show the limit',
      greyed.state === 'greyed' && greyed.reason === 'capability', JSON.stringify(greyed));

    // An APP's entry is offered where that app is composed, and nowhere else — the composition rung
    // still applies to apps; only the device is exempt from it.
    const apps = { basis: basisManifest, tasks: tasksManifest };
    const withTasks = offeredHere({ catalogue: circleCatalogue('addTask'), apps });
    check('a circle that composes tasks is offered "+ → Task" — by DECLARATION, not by shell code',
      withTasks.includes('addTask'), withTasks.join(','));
    const withoutTasks = offeredHere({ catalogue: circleCatalogue('listOpen'), apps });
    check('…and a circle that does not compose tasks is not',
      !withoutTasks.includes('addTask'), withoutTasks.join(','));

    // ── 2 · WHAT A TAP BECOMES ────────────────────────────────────────────────────────────────────
    const t = (k, v) => (v?.title ? `${k}:${v.title}` : k);

    const card = composerReplyToStream({
      kind: 'time-card', appOrigin: 'calendar',
      itemRef: { app: 'calendar', type: 'calendar-event', id: 'evt-1' },
      snapshot: { id: 'evt-1', type: 'calendar-event', title: 'Koffie bij Frits' },
    }, { t });
    check('an op that answers with a card becomes a message the CIRCLE sees',
      card?.kind === 'card' && card.card?.kind === 'time-card', JSON.stringify(card)?.slice(0, 100));
    check('…carrying a caption, so a shell that paints no card still shows a sentence',
      typeof card?.text === 'string' && card.text.includes('Koffie bij Frits'), card?.text);

    const note = composerReplyToStream({ ok: false, error: 'NKN not connected.' }, { t });
    check('an op that refuses becomes a LOCAL note — the circle is not told what my device could not do',
      note?.kind === 'note' && note.text.includes('NKN'), JSON.stringify(note));

    const said = composerReplyToStream({ message: 'Block set is empty.' }, { t });
    check('an op that reports becomes a local note too', said?.kind === 'note', JSON.stringify(said));

    check('an op with nothing to say says nothing — never a bubble of JSON',
      composerReplyToStream({ ok: true }, { t }) === null
      && composerReplyToStream(null, { t }) === null);

    // ── 3 · A CREATOR'S CARD ──────────────────────────────────────────────────────────────────────
    // "+ → Task" dispatches `tasks:addTask`, which answers `{ok, itemId}` — creating is its job and
    // the conversation is not its business. Without the read-back the task would exist in the Tasks
    // tab and the conversation it was made in would show a bare "ok". The bridge is declared, not
    // coded: the op says which skill reads its snapshot.
    const addTask = tasksManifest.operations.find((o) => o.id === 'addTask');
    check('the task entry declares how its card is read', !!addTask?.surfaces?.chat?.embed?.cardSnapshotSkill,
      addTask?.surfaces?.chat?.embed?.cardSnapshotSkill ?? '(none)');

    const asked = [];
    const made = await cardForCreatedItem({
      reply: { ok: true, itemId: 't-42' }, op: addTask, appOrigin: 'tasks', localActor: 'me',
      callSkill: async (app, skill, args) => {
        asked.push(`${app}:${skill}`);
        return { id: args.id, type: 'task', title: 'Afwas', status: 'open' };
      },
    });
    check('a created task becomes a card, read back from the app that made it',
      made?.kind === 'item-card' && made.itemRef?.app === 'tasks' && made.snapshot?.title === 'Afwas',
      JSON.stringify(made)?.slice(0, 120));
    check('…asked of the SAME app, not of whichever app declares a snapshot first',
      asked.join(',') === 'tasks:getTaskSnapshot', asked.join(','));

    const noCard = await cardForCreatedItem({
      reply: { ok: true, itemId: 'x' }, op: { surfaces: {} }, appOrigin: 'tasks', callSkill: async () => ({}),
    });
    check('an op that declares no card gets none — the reply stands on its own', noCard === null);
  } catch (err) {
    check('the attach-offer corridor completed', false, String(err?.message ?? err).slice(0, 200));
  }
  return results;
}
