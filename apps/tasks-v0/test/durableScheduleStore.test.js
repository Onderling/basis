/**
 * Batch 7 — the durable schedule store is THREADED, not merely shipped.
 *
 * `PodScheduleStore` existed, tested, since Task #14; nothing constructed it — every restart forgot
 * every scheduled deadline nudge (the inert-seam class). `createCircleAgent` now accepts
 * `{ podClient, scheduleStoreUri }` and the fallback notifier persists through them; absent, the
 * in-memory store keeps yesterday's behaviour exactly.
 */
import { describe, it, expect } from 'vitest';
import { PodScheduleStore, InMemoryScheduleStore } from '@onderling/notifier';
import { createCircleAgent } from '../src/Circle.js';
import { buildBundle } from '../src/storage/buildBundle.js';

/** A pod client the store can read/write — one JSON blob in memory. */
function memPodClient() {
  const blobs = new Map();
  return {
    blobs,
    async read(uri) { return blobs.get(uri) ?? null; },
    async write(uri, content) { blobs.set(uri, content); },
  };
}

describe('createCircleAgent — durable schedule threading', () => {
  it('with { podClient, scheduleStoreUri } the fallback notifier persists via PodScheduleStore', async () => {
    const podClient = memPodClient();
    // The Phase-6 notifier seam lives inside the `localStoreBundle` enrichment — same as production.
    const bundle = await createCircleAgent({
      localStoreBundle: buildBundle(), wireOnboardingSkills: false,
      podClient, scheduleStoreUri: 'mem://pod/notifier/jobs.json',
    });
    expect(bundle.notifier?.scheduleStore).toBeInstanceOf(PodScheduleStore);

    // The threading is real end-to-end: a scheduled job lands in the pod blob.
    await bundle.notifier.scheduleOnce({
      triggerAt: Date.now() + 60_000,
      recipient: 'webid:ann',
      channel:   'silent',
      cancelKey: 'due:item-1',
      builder:   async () => ({ text: 'Deadline missed: "x"' }),
    });
    const blob = podClient.blobs.get('mem://pod/notifier/jobs.json');
    expect(blob, 'the job must persist to the pod URI').toBeTruthy();
    expect(JSON.stringify(blob)).toContain('due:item-1');
    await bundle.stop?.();
  });

  it('without pod args the in-memory store keeps the pre-existing behaviour', async () => {
    const bundle = await createCircleAgent({ localStoreBundle: buildBundle(), wireOnboardingSkills: false });
    expect(bundle.notifier?.scheduleStore).toBeInstanceOf(InMemoryScheduleStore);
    await bundle.stop?.();
  });
});
