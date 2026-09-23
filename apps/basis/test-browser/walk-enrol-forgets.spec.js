/**
 * A FRESHLY ENROLLED DEVICE FORGETS ITS THROWAWAY SELF — on real browser bytes.
 *
 * Every device boots unenrolled first and writes content under an identity of its own; the add-a-device
 * ceremony then replaces that identity and its content key, and what the old self wrote becomes rows nobody on
 * this device can open. The box swept them from 2026-09-14; web and mobile did not, and the symptom is visible
 * in every live-walk log we have: ten `[at-rest] … stored here but not openable with this device's content key`
 * warnings on the second device's first boot, kept for ever.
 *
 * WHY THIS IS A BROWSER SPEC AND NOT A UNIT TEST. The unit tests pin the list, the order and the note. None of
 * them can see the thing that actually goes wrong, which is what the device looks like AFTER the reload — and
 * the first version of this fix passed every unit test while being unreachable from the path this file takes:
 * the clear hung off the flow's reload button, and enrolling through the op went straight past it. So the
 * assertion that matters is made here, on a device that enrolled the way the walks enrol.
 *
 * It also asserts the other half — that the device comes back WHOLE. A clear that takes the registry with it
 * would leave a device enrolled in the vault and in no circle, which is worse than the warnings it fixes.
 *
 * PROVEN TO FAIL (2026-09-23): with `runPendingForget` returning early, this walk goes red on "boot said it
 * forgot the throwaway self". See the note beside that assertion for which line is the evidence and which is
 * only a net.
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, createCircle, log } from './peerHarness.js';

const call = (page, app, op, args = {}) => page.evaluate(([a, o, g]) => window.onderlingCall(a, o, g), [app, op, args]);
// ids come back as STRINGS in practice and as rows in some paths — normalise both, as every consumer in the
// app does. A `.map((c) => c.id)` here returned nothing and sent the first run of this walk chasing a circle
// that had been made perfectly well.
const myCircles = async (page) => ((await call(page, 'stoop', 'listMyCircles', {}))?.circles ?? [])
  .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);

/** The exact warning the unopenable rows produce. One place, so the assertion and the report cannot drift. */
const NOT_OPENABLE = /\[at-rest\].*not openable with this device's content key/i;

const until = async (fn, { timeout = 60_000, step = 1000 } = {}) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* keep trying */ }
    if (Date.now() - t0 > timeout) return null;
    await new Promise((r) => { setTimeout(r, step); });
  }
};

test.describe('the add-a-device ceremony leaves nothing of the former self', () => {
  test.setTimeout(240_000);

  let A = null;
  let A2 = null;
  test.afterAll(async () => { await teardown([A, A2].filter(Boolean)); });

  test('a second device enrolled from an offer boots clean, and is in the circle', async ({ browser }) => {
    // ── A, the person, with a circle of their own ──────────────────────────────────────────────────────
    A = await bootPeer(browser, 'A(first device)');
    await gotoCircles(A.page);
    const name = `Enrol walk ${Date.now().toString(36).slice(-4)}`;
    await createCircle(A.page, name);
    const gid = await until(async () => {
      const ids = await myCircles(A.page);
      return ids.find((id) => id && id !== 'cc-help') ?? null;
    });
    expect(gid, 'A made a circle').toBeTruthy();
    const aWho = await call(A.page, 'stoop', 'whoAmI', {});

    // ── A SECOND DEVICE, which first boots as NOBODY and writes its own content ───────────────────────
    // This is the state the whole fix is about: an unenrolled install with a registry record, a member map
    // with itself in it, settings, held messages and a device log — all sealed to a key it is about to lose.
    A2 = await bootPeer(browser, 'A(second device)');
    const beforeWarnings = [];
    A2.page.on('console', (m) => { if (NOT_OPENABLE.test(m.text())) beforeWarnings.push(m.text()); });
    await gotoCircles(A2.page);
    // Give the throwaway self something of its own to leave behind, so "nothing was there anyway" cannot be
    // the reason this passes.
    await createCircle(A2.page, 'Throwaway circle');
    const throwaway = await until(async () => ((await myCircles(A2.page)).length ? await myCircles(A2.page) : null));
    expect(throwaway.length, 'the throwaway self really is in circles of its own').toBeGreaterThan(0);
    const throwawayWho = await call(A2.page, 'stoop', 'whoAmI', {});
    expect(throwawayWho?.webid, 'and it is a different person from A').not.toBe(aWho?.webid);

    // ── THE CEREMONY, through the op — the way a walk enrols, and the path the first fix missed ───────
    const offer = await call(A.page, 'household', 'buildEnrollOffer', {});
    expect(offer?.ok, JSON.stringify(offer)).toBe(true);
    const phrase = (await call(A.page, 'household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(phrase, 'the phrase is readable on A').toBeTruthy();

    const enrolled = await A2.page.evaluate(async ([uri, words]) => {
      localStorage.setItem('onderling.enrollOffer', uri);
      return window.onderlingCall('household', 'enrollDevice', { mnemonic: words, label: 'enrol-walk' });
    }, [offer.uri, phrase]);
    expect(enrolled?.ok, JSON.stringify(enrolled)).toBe(true);
    // No UI was driven, and no flag was read off the result: the ceremony left a note in the vault.
    log('the ceremony ran through the op', 'INFO', 'no UI driven');

    // ── THE RELOAD: boot reads the note, forgets the former self, and finishes the ceremony ───────────
    const afterWarnings = [];
    const forgetLines = [];
    A2.page.on('console', (m) => {
      const txt = m.text();
      if (NOT_OPENABLE.test(txt)) afterWarnings.push(txt);
      if (/\[enrol\] forgot the throwaway self/.test(txt)) forgetLines.push(txt);
    });
    await A2.page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => A2.page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true);

    // (1) IT CAME BACK WHOLE — the half that matters more than the warnings.
    const inCircle = await until(async () => ((await myCircles(A2.page)).includes(gid) ? true : null), { timeout: 90_000 });
    expect(inCircle, "the enrolled device consumed the offer and is in A's circle").toBe(true);
    const a2Who = await call(A2.page, 'stoop', 'whoAmI', {});
    expect(a2Who?.webid, 'and it is the SAME person as A now').toBe(aWho?.webid);

    // (2) THE FORMER SELF IS GONE. This line is the load-bearing one: sabotaging the clear (2026-09-23,
    // `runPendingForget` returning early) turns THIS assertion red, which is how we know the walk can fail.
    expect(forgetLines.length, `boot said it forgot the throwaway self (saw: ${JSON.stringify(forgetLines)})`).toBeGreaterThan(0);
    // …and no unopenable rows survive. HONEST NOTE: this assertion has never been observed to FIRE here — the
    // `[at-rest]` warnings that make L117 visible came from the LIVE build, and this local harness produced
    // none in either the healthy or the sabotaged run. So it is a net, not the proof: keep it, because on a
    // build that does produce them it would catch exactly the regression, but do not read a green here as
    // evidence that the warnings are gone. The evidence is the line above, plus (1) and (3).
    expect(afterWarnings, `no "not openable" rows survive the ceremony — ${afterWarnings.length} did:\n${afterWarnings.slice(0, 5).join('\n')}`).toEqual([]);

    // (3) …and the throwaway self's own circle is not in the enrolled person's list.
    const nowIn = await myCircles(A2.page);
    for (const id of throwaway) {
      if (id === 'cc-help') continue;   // the help circle is re-provisioned for the new person, same id
      expect(nowIn, `the throwaway self's circle ${id} is not the enrolled person's`).not.toContain(id);
    }
    log('a fresh enrol forgets the throwaway self', 'PASS',
      `${forgetLines[0] ?? ''} · warnings before: ${beforeWarnings.length}, after: ${afterWarnings.length}`);
  });
});
