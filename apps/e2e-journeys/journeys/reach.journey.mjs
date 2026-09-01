// J-reach: the doors a person can SEE, walked one by one.
//
// The rule this serves (Frits, 2026-08-31): *"create at least one user journey for each opid to test
// it. If we cant find any story for the op that makes sense, then its probably time to remove it."*
// Every other journey here enters through `callSkill` — the waist, a person on their own device. That
// is the right entry for an op an APP serves. It cannot be the entry for basis's OWN ops, and finding
// out why is what this journey is for.
//
// Two doors were opened for those ops, and each gets its story below:
//
//   THE DRAWER   Advanced projects every op that declares no screen (`advancedOpRows`) and offers it —
//                `Run` when it takes no input, a form built from its declared params when it does.
//                Both shells paint the SAME rows from the same projection.
//   THE TYPED DOOR  a `/command` in any composer, offered and filtered by what this place actually has
//                (`createComposerCommands`), in a circle and in a 1:1 contact thread alike.
//
// ── WHY THE LAST CHECK EXISTS ───────────────────────────────────────────────────────────────────────
// When this journey was written the handlers all worked and the DRAWER reached none of them. Both
// drawers dispatch a tapped row with `callSkill(row.app, row.op, args)` — web `circleApp.js`, mobile
// `CircleAdvancedScreen` via `bundle.callSkill` — which is the AGENT's waist, and basis's own ops were
// not on it. The agent answered `unknown appOrigin "basis"` while the form said "✓ Submitted": twenty-
// three rows a person could read, tap, and get nothing from.
//
// basis's ops are now mounted on the waist like any other app's (`realAgent`'s `basis` branch, upgraded
// per shell with `mountAppOps`), so the last check passes. It stays because it is the only check that
// asks the question a person's tap asks, and the answer was silently no for months. Every check before
// it drives the same handler through the table directly, so a red there says "the handler broke" and a
// red in the last one says "the route broke" — which half is which, not merely that something is.
import { readFileSync } from 'node:fs';
import { checker } from './_util.mjs';
import { declaredOp } from './_util.mjs';

import basisManifest from '../../basis/manifest.js';
import { mergeManifests } from '../../basis/src/manifestMerge.js';
import { createLocalBuiltins } from '../../basis/src/core/localBuiltins.js';
import { advancedOpRows } from '../../basis/src/v2/advancedSurface.js';
import { createComposerCommands } from '../../basis/src/v2/composerCommands.js';
import { bootRealAgentNode, teardown } from '../../basis/test/support/pairRealAgents.js';

export const name = 'J-reach (the doors a person can see — the drawer and the typed command)';

/**
 * The app's own English copy, read as data. `initLocalisation` imports its JSON without an import
 * attribute, which vite and vitest allow and plain node does not — so the journey resolves the same
 * files itself rather than pulling a browser loader into the runner. Same keys, same `{{var}}` shape.
 */
function englishT() {
  const load = (f) => JSON.parse(readFileSync(new URL(`../../basis/src/locales/${f}`, import.meta.url), 'utf8'));
  const packs = { circle: load('circle.en.json'), host: load('host.en.json') };
  return (key, vars = {}) => {
    const [head, ...rest] = String(key).split('.');
    let node = packs[head] ?? packs.host;
    for (const seg of (packs[head] ? rest : [head, ...rest])) node = node?.[seg];
    const text = typeof node?.text === 'string' ? node.text : (typeof node === 'string' ? node : key);
    return text.replace(/\{\{(\w+)\}\}/g, (_, v) => (vars[v] ?? `{{${v}}}`));
  };
}

export async function run() {
  const { results, check } = checker();
  let me = null;

  try {
    const t = englishT();
    const catalogue = mergeManifests([{ manifest: basisManifest }]);

    // The seams a shell injects. Each is the real boundary the handler talks to (a scanner, a picker,
    // an event log, the brief and find runners) — recorded rather than faked away, so "the door ran the
    // op" is a claim about what the op DID, not just that it returned an object.
    const opened = { scanner: 0, picker: 0, logsPanel: 0 };
    const asked = { find: [], brief: [] };
    // The shell's thread seams: `help-with` opens a thread about a post and switches you into it.
    const threads = new Map();
    const active = { at: null };
    const threadStore = {
      getThread: (id) => threads.get(id) ?? null,
      createThread: (spec) => { threads.set(spec.id, { ...spec, messages: [] }); return threads.get(spec.id); },
      addMessage: (id, m) => { threads.get(id)?.messages.push(m); },
    };
    const setActive = (id) => { active.at = id; };
    const eventLog = {
      recent: async () => [{ at: Date.now(), app: 'basis', type: 'journey.tick', actor: 'me' }],
      list:   async () => [{ at: Date.now(), app: 'basis', type: 'journey.tick', actor: 'me' }],
    };
    me = await bootRealAgentNode('reach');
    const table = createLocalBuiltins({
      catalogue, t, agent: me.agent, eventLog, threadStore, setActive,
      openQrScanner: () => { opened.scanner += 1; },
      openLogsPanel: () => { opened.logsPanel += 1; },
      openFilePicker: async () => { opened.picker += 1; return null; },
      findRunner:  async ({ query }) => { asked.find.push(query); return { ok: true, hits: [] }; },
      briefRunner: async (args) => { asked.brief.push(args ?? {}); return { ok: true, sections: [] }; },
    });

    // ── The drawer, as the shells project it ──────────────────────────────────────────────────────
    const rows = advancedOpRows({ manifests: [basisManifest] });
    const rowFor = (op) => rows.find((r) => r.app === 'basis' && r.op === op) ?? null;
    /** Run a row the way a shell does: `Run` with no input, or the form's params filled in. */
    const throughTheDrawer = async (op, args = {}) => {
      const row = rowFor(op);
      if (!row) return { row: null, reply: null };
      return { row, reply: await table[op]?.(row.runnable ? {} : args) };
    };

    check('the drawer offers a row for every op this journey walks',
      ['find', 'brief', 'logs', 'help', 'help-with', 'whoami', 'muted', 'scanQr', 'send-file']
        .every((op) => !!rowFor(op)),
      rows.filter((r) => r.app === 'basis').map((r) => r.op).join(','));

    // help — the printed list. Frits kept it deliberately ("a printed list could still be useful"), so
    // the story is that it prints, and prints the SHELVES the drawer uses rather than a flat wall.
    await declaredOp('basis', 'help');
    const help = await table.help({});
    const helpText = String(help?.message ?? help ?? '');
    check('/help prints a list, grouped by the same shelves the drawer paints',
      helpText.length > 0 && /Identity|Diagnostics|People/.test(helpText), helpText.slice(0, 90));

    // whoami — a no-input row: tap Run, get an answer about who you are signed in as. It answers with
    // a STRUCTURED reply, so a surface can render it without parsing prose.
    await declaredOp('basis', 'whoami');
    const who = await throughTheDrawer('whoami');
    check('the drawer runs whoami and it answers who you are — structured, not prose',
      who.row?.runnable === true && who.reply?.signedIn === false && typeof who.reply?.message === 'string',
      JSON.stringify(who.reply).slice(0, 90));

    // muted — the same shape, and the op a person reaches for after blocking someone.
    await declaredOp('basis', 'muted');
    const muted = await throughTheDrawer('muted');
    check('the drawer runs muted and it lists the blocked peers (none yet, said plainly)',
      !!muted.reply && muted.reply.ok !== false, JSON.stringify(muted.reply).slice(0, 90));

    // find — the form path: the row declares `query` as required, so the shell builds a field for it
    // and the handler must receive exactly what was typed.
    await declaredOp('basis', 'find');
    const find = await throughTheDrawer('find', { query: 'blue bicycle' });
    check('the drawer opens a form for find, and the query reaches the search runner',
      find.row?.runnable === false && find.row.requiredParams.includes('query')
        && asked.find[0] === 'blue bicycle', JSON.stringify(asked.find));

    // brief — the morning summary. No required params, so it is a Run.
    await declaredOp('basis', 'brief');
    const brief = await throughTheDrawer('brief');
    check('the drawer runs brief and the brief runner is asked for it',
      brief.row?.runnable === true && asked.brief.length === 1, JSON.stringify(brief.reply).slice(0, 80));

    // logs — "what happened while I was away", a member question and not only an operator one.
    await declaredOp('basis', 'logs');
    const logs = await throughTheDrawer('logs');
    check('the drawer runs logs and recent events come back',
      !!logs.reply && logs.reply.ok !== false, JSON.stringify(logs.reply).slice(0, 90));

    // help-with — "I'll help with that post": it opens a thread ABOUT the post and puts you in it. It
    // has no row button in the drawer, and cannot get one yet: `surfaces.ui.labelKey` is schema-validated
    // and read by NOTHING (every projector does `label: ui.label ?? op.id`), so the button would have
    // said "help-with". The op itself works, which is why the missing label is worth fixing rather than
    // the op worth removing.
    await declaredOp('basis', 'help-with');
    const helpWith = await table['help-with']({ postId: 'post-42' });
    check('help-with opens a thread about the post and makes it the active one'
      + ' (its ROW BUTTON is still missing — the labelKey gap)',
      helpWith?.ok !== false && !!threads.get('help-post-42') && active.at === 'help-post-42',
      JSON.stringify({ reply: helpWith, active: active.at }).slice(0, 110));

    // scanQr — the op that had no story anywhere (journeys-per-op: "named nowhere"). Its whole job is
    // to open the camera, so the story is that tapping it opens the scanner the shell injected.
    await declaredOp('basis', 'scanQr');
    await throughTheDrawer('scanQr');
    check('the drawer runs scanQr and the camera is opened', opened.scanner === 1, `opened=${opened.scanner}`);

    // send-file — its own door is still owed (it waits on the + menu question); the op works today.
    // Two halves of one story. FIRST, on a device that is not on the peer network, it refuses and says
    // so instead of opening a picker for a file it could never send — the state most devices are in.
    await declaredOp('basis', 'send-file');
    const offlineSend = await table['send-file']({ peer: 'app.someone.1234' });
    check('send-file on a device that is not peer-connected refuses, and does not open a picker',
      offlineSend?.ok === false && opened.picker === 0, JSON.stringify(offlineSend).slice(0, 90));

    // SECOND, connected, it asks for the file. The peer TRANSPORT is the one doubled seam here (this
    // harness has no NKN), so what is proven is the handler's own contract: named peer + connected
    // transport → the picker opens. Delivery itself is the two-party journey's job, not this one's.
    const sent = [];
    const connected = createLocalBuiltins({
      catalogue, t,
      agent: { peer: { status: 'connected', address: 'app.me.0001' }, sendPeerMessage: async (...a) => { sent.push(a); return true; } },
      openFilePicker: async () => { opened.picker += 1; return null; },
    });
    await connected['send-file']({ peer: 'app.someone.1234' });
    check('send-file on a connected device asks the file picker for a file',
      opened.picker === 1, `picker=${opened.picker}`);

    // ── The typed door — the same op, reached by typing, in both kinds of thread ──────────────────
    const circleDoor = createComposerCommands({ kind: 'circle', catalogue });
    const typedHelp = circleDoor.parse('/help');
    check('typing /help in a circle composer compiles to the help op',
      typedHelp?.id === 'help' || typedHelp?.opId === 'help', JSON.stringify(typedHelp));
    check('and the composer SUGGESTS it while you type, filtered to what this place offers',
      (circleDoor.suggest('/hel') ?? []).some((s) => String(s.command ?? s).includes('help')),
      JSON.stringify(circleDoor.suggest('/hel')).slice(0, 90));
    check('a line the composer does not offer is left alone, so it goes to the thread as chat',
      circleDoor.parse('/definitely-not-an-op here') === null);

    const contactDoor = createComposerCommands({
      kind: 'contact',
      skills: [{ id: 'ping', description: 'say hello' }, { id: 'status', description: 'how are you' }],
    });
    check('the same typed door works in a 1:1 contact thread, over that peer\'s own skills',
      contactDoor.parse('/ping hello')?.opId === 'ping'
        && (contactDoor.suggest('/pi') ?? []).length > 0, JSON.stringify(contactDoor.parse('/ping hello')));

    // ── The route ─────────────────────────────────────────────────────────────────────────────────
    // What the drawer ACTUALLY calls when a row is tapped, on both shells. Asserted as ARRIVAL, not as
    // success: `whoami` on a device nobody has signed in on correctly answers "not signed in", and a
    // check that demanded ok:true would go red for the honest reason and hide the dishonest one. What
    // must be true is that the reply is the HANDLER's own (it says whether you are signed in) and not
    // the boundary's (`unknown-op` / `not-mounted`, or a throw).
    let dispatched = null;
    let dispatchErr = '';
    try {
      dispatched = await me.agent.callSkill('basis', 'whoami', {});
    } catch (err) { dispatchErr = String(err?.message ?? err).slice(0, 120); }
    check('tapping a drawer row dispatches it — callSkill(basis, …) reaches the handler',
      !dispatchErr && typeof dispatched?.signedIn === 'boolean'
        && dispatched.error !== 'unknown-op' && dispatched.error !== 'not-mounted',
      dispatchErr || JSON.stringify(dispatched).slice(0, 120));

    // …and an op that needs nothing but the agent runs end to end over that same route, on a bare
    // composition with no shell in it: the promise is "mounted everywhere", not "mounted where a shell
    // remembered to". A person who blocked someone can ask who they blocked from the drawer.
    const overTheWaist = await me.agent.callSkill('basis', 'muted', {});
    check('and an op that needs only the agent runs end to end over the waist, with no shell mounted',
      !!overTheWaist && overTheWaist.ok !== false, JSON.stringify(overTheWaist).slice(0, 90));

    // An op the manifest does not declare refuses in a shape a surface can paint, rather than throwing
    // at the boundary — the difference between "not available here" and "the app broke".
    //
    // The id is BUILT rather than written, and that is deliberate: `lint-callskill-literals` reads every
    // literal `callSkill('app','op')` and fails when the op is not in that app's manifest, which is
    // exactly the typo this journey would otherwise look like. The one call site whose purpose is to be
    // undeclared should not be spelled in the form the guard is right to reject.
    const noSuchOp = ['not', 'an', 'op'].join('-');
    const unknown = await me.agent.callSkill('basis', noSuchOp, {});
    check('an op the manifest does not declare is refused in a shape a surface can paint',
      unknown?.ok === false && unknown.error === 'unknown-op', JSON.stringify(unknown));
  } catch (err) {
    check('the reach corridor completed', false, String(err?.message ?? err).slice(0, 250));
  } finally {
    if (me) await teardown(me);
  }
  return results;
}
