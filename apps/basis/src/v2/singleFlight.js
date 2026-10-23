/**
 * ONE in-flight build per key: a caller that arrives while the first is still building gets the first's promise.
 *
 * A circle opening asks for its pod producer from several places at once (the board's seal strategy, the media
 * composition, the roster seed). Each "is it built yet?" check and its build were awaits apart, so each caller built
 * its own producer — and each minted its own "version 1" group key, so co-members could hold a different key than the
 * one a post was sealed with. Both shells guard the same builds through this.
 *
 * Only the overlap is joined: once the promise settles it is forgotten, so a build that failed is tried afresh by the
 * next caller (the shells cache a SUCCESS themselves) — a retry is not masked.
 *
 * @returns {(key: string, build: () => Promise<any>) => Promise<any>}
 */
export function createSingleFlight() {
  const inFlight = new Map();
  return (key, build) => {
    if (inFlight.has(key)) return inFlight.get(key);
    const p = Promise.resolve().then(build).finally(() => { inFlight.delete(key); });
    inFlight.set(key, p);
    return p;
  };
}
