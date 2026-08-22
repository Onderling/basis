// J-podmodes: the SAME circle corridor, with and without a central pod.
//
// This is the question Frits asked first: "many functions should be checked in how they work in
// circles, and its different modes — without central pods and with a central pod." Until now nothing
// ran one corridor twice under two modes; what existed was hand-copied file pairs with different
// assertions, which cannot tell you whether the modes agree.
//
// So: one corridor, one set of assertions, run twice.
//   mode A — pod: none    the default a circle gets; content lives with the people
//   mode C — pod: shared  every member's circle store write-throughs to one pod
//
// The claim under test is the person-level one: **a member's experience does not depend on where the
// circle keeps its content.** Joining, seeing the roster, posting and reading back must hold either
// way. Where the modes legitimately DIFFER — what is at rest on the pod — the journey asserts the
// difference instead of ignoring it: with a pod, the content is there and it is SEALED.
//
// Runs in the app's composition (`_app.mjs`), so the lanes are real, and against whatever relay the
// runner was given.
import { checker } from './_util.mjs';
import { bootAppCircle, rosterOf, hasMember, untilTrue, makeSharedPod } from './_app.mjs';

export const name = 'J-podmodes (one corridor, run with and without a central pod)';

/** The corridor. Identical assertions in both modes — that is the whole point. */
async function corridor({ relayUrl, circleId, pod, check, label }) {
  const circle = await bootAppCircle({ relayUrl, circleId, handles: ['anne', 'bram'], pod });
  try {
    const [anne, bram] = circle.people;

    check(`[${label}] the circle exists and the roster folded`,
      hasMember(await rosterOf(anne, circleId), bram.pubKey));

    check(`[${label}] the joiner sees the circle on their OWN device`,
      hasMember(await rosterOf(bram, circleId), anne.pubKey));

    // A real write through the waist, read back on the other person's device.
    const created = await anne.agent.callSkill('tasks', 'addTask', { text: 'de goot schoonmaken', circleId });
    check(`[${label}] the write succeeded`, !!created?.itemId, JSON.stringify(created)?.slice(0, 120));

    const readsIt = await untilTrue(async () => {
      const r = await bram.agent.callSkill('tasks', 'listOpen', { circleId });
      return (r?.items ?? []).some((t) => t.id === created.itemId);
    });
    check(`${pod ? '[F-007] ' : ''}[${label}] the other member reads it back — the mode does not change what a person sees`, readsIt);

    // Narrowing which STORE the pod medium serves: the proven cache-mode recipe writes through the
    // HOUSEHOLD store, so ask both and let the answer be specific rather than "the pod mode is broken".
    const hh = await anne.agent.callSkill('household', 'addItem', { type: 'shopping', text: 'melk halen', circleId });
    check(`[${label}] a household item can be written`, !hh?.error, JSON.stringify(hh)?.slice(0, 120));
    const hhSeen = await untilTrue(async () => {
      const r = await bram.agent.callSkill('household', 'listOpen', { circleId });
      const items = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : []);
      return items.some((i) => (i?.text ?? '') === 'melk halen');
    }, 10000);
    check(`${pod ? '[F-007] ' : ''}[${label}] the other member reads the household item back`, hhSeen);

    // The rules doc is lane-shaped, so it exercises a different path than the item store.
    const edited = await anne.agent.callSkill('stoop', 'editGroupRules', {
      groupId: circleId, rules: { name: 'Huisregels', purpose: 'proef', agreements: 'wees aardig' },
    });
    check(`[${label}] the admin can set the circle's rules`, !edited?.error, JSON.stringify(edited)?.slice(0, 120));

    return circle;
  } catch (err) {
    check(`[${label}] the corridor completed`, false, String(err?.message ?? err).slice(0, 160));
    return circle;
  }
}

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let a = null; let c = null;

  try {
    // ── mode A — no pod anywhere ─────────────────────────────────────────────────────────────────
    a = await corridor({ relayUrl, circleId: 'e2e-mode-nopod', pod: null, check, label: 'no pod' });

    // ── mode C — one central pod behind every member's store ─────────────────────────────────────
    const pod = makeSharedPod();
    c = await corridor({ relayUrl, circleId: 'e2e-mode-pod', pod, check, label: 'central pod' });

    // Where the modes SHOULD differ, say so: with a pod, content reaches it, and it is sealed at rest.
    const landed = await untilTrue(async () => pod.store.size > 0, 8000);
    check('[F-007] [central pod] the circle\'s content actually reaches the pod', landed,
      `${pod.store.size} object(s) at rest`);

    if (pod.store.size > 0) {
      const atRest = [...pod.store.values()].map((v) => String(v)).join('\n');
      check('[central pod] what is at rest is SEALED, not plaintext',
        !atRest.includes('de goot schoonmaken') && atRest.includes('SEALED('),
        atRest.includes('de goot schoonmaken') ? 'PLAINTEXT FOUND AT REST' : 'ciphertext only');
    }
  } finally {
    await a?.close?.().catch(() => {});
    await c?.close?.().catch(() => {});
  }
  return results;
}
