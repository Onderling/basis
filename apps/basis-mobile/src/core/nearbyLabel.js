/**
 * 5.9c — formatter for the passive local-network "who's here" row on
 * the v2 circle launcher.  Lives in /core so vitest (which excludes
 * src/screens/**, no JSX loader) can cover it without a RN test
 * renderer.  CircleLauncherScreen consumes the named export and pairs
 * it with `bundle.mdns.connectionCount`.
 *
 * Renders: `<label>: <count> device(s)`  e.g.  "Nearby: 3 device(s)".
 * Zero-state is rendered honestly ("Nearby: 0 device(s)") — that's the
 * "mDNS is live but nobody is in earshot yet" signal.  Hide-vs-show is
 * decided one level up (by whether `bundle.mdns` exists at all).
 *
 * Defensive against non-finite / negative counts (treats them as 0).
 */
export function formatNearbyLabel(count, t, { radioOff = false } = {}) {
  // The switch outranks the count: a radio that is off has SEEN nothing, so claiming a number —
  // even zero — would be the count row pretending to look.
  if (radioOff) return `${t('circle.nearby.label')}: ${t('circle.nearby.off')}`;
  const n = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
  return `${t('circle.nearby.label')}: ${t('circle.nearby.count', { count: n })}`;
}
