/**
 * THE KEPT SETTINGS CHANGES, PER DEVICE: what the settings lane's receiver gate kept for a circle, noted by the lane on
 * each apply and read by the content judge (`contentJudge.js`). Keyed on the device's own log, which the lane and the
 * rails both hold, so agents sharing one process never share them. No imports: the lane and the judge both use it.
 */
const keptByLog = new WeakMap();       // device log → Map<circleId, kept policy-update bodies>
const listenersByLog = new WeakMap();  // device log → Set<(circleId) => void>

/** The settings lane's kept changes for a circle on this device (each apply). Heard by this device's rails. */
export function noteKeptPolicyChanges(deviceLog, circleId, kept) {
  if (!deviceLog || typeof deviceLog !== 'object' || typeof circleId !== 'string' || !circleId) return;
  const byCircle = keptByLog.get(deviceLog) ?? keptByLog.set(deviceLog, new Map()).get(deviceLog);
  byCircle.set(circleId, Array.isArray(kept) ? kept.slice() : []);
  for (const fn of listenersByLog.get(deviceLog) ?? []) { try { fn(circleId); } catch { /* a listener's fault is its own */ } }
}

/** @returns {object[]|undefined}  undefined = not known on this device yet */
export function keptPolicyChangesOf(deviceLog, circleId) {
  return (deviceLog && keptByLog.get(deviceLog)?.get(circleId)) ?? undefined;
}

/** Hear when this device's kept changes for a circle were noted (the rails re-judge then). */
export function onKeptPolicyChanges(deviceLog, fn) {
  if (!deviceLog || typeof fn !== 'function') return () => {};
  const set = listenersByLog.get(deviceLog) ?? listenersByLog.set(deviceLog, new Set()).get(deviceLog);
  set.add(fn);
  return () => { set.delete(fn); };
}
