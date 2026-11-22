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

/**
 * NOT KNOWN IS ASKED FOR, NEVER WAITED ON. The lane applies when a settings statement ARRIVES; at a quiet start nothing
 * arrives, so a rail that finds a circle's kept changes not known asks this device's settings lane to apply once
 * (`provideKeptPolicyChanges`, registered by the lane when it is handed its rail). One ask in flight per circle.
 */
const providerByLog = new WeakMap();   // device log → (circleId) => Promise
const askingByLog = new WeakMap();     // device log → Set<circleId> in flight
export function provideKeptPolicyChanges(deviceLog, fn) {
  if (deviceLog && typeof deviceLog === 'object' && typeof fn === 'function') providerByLog.set(deviceLog, fn);
}
export function requestKeptPolicyChanges(deviceLog, circleId) {
  const fn = deviceLog ? providerByLog.get(deviceLog) : null;
  if (typeof fn !== 'function' || typeof circleId !== 'string' || !circleId) return false;
  const asking = askingByLog.get(deviceLog) ?? askingByLog.set(deviceLog, new Set()).get(deviceLog);
  if (asking.has(circleId)) return true;
  asking.add(circleId);
  Promise.resolve().then(() => fn(circleId)).catch(() => {}).finally(() => asking.delete(circleId));
  return true;
}
