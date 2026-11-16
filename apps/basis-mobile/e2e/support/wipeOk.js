/**
 * May a walk that DELETES THE APP run on this device? An emulator: yes. A real phone: only a TEST device whose wipe was
 * agreed, and only when the run names it. Two locks, both needed:
 *   - the device's exact serial is on WIPEABLE_TEST_DEVICES below (agreed, changed only by a reviewed PR);
 *   - the run names that serial in `E2E_WIPE_OK` (comma-separated), so no run wipes a phone by accident.
 * Every phone not on the list is refused, whatever a run names: a personal phone is simply never put on it.
 */
// The Samsung A33 kept for tests (2026-11-16: both agents may use it, wipes included).
const WIPEABLE_TEST_DEVICES = Object.freeze(['RFCT504SRZH']);

function mayWipe(deviceId, env = process.env) {
  const id = String(deviceId ?? '');
  if (id.startsWith('emulator-')) return true;
  if (!id || !WIPEABLE_TEST_DEVICES.includes(id)) return false;
  const named = String(env?.E2E_WIPE_OK ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return named.includes(id);
}

module.exports = { mayWipe, WIPEABLE_TEST_DEVICES };
