/**
 * May a walk that DELETES THE APP run on this device? An emulator: yes. A real phone: only a TEST device whose wipe was
 * agreed, and only when the run names it. Two locks, both needed:
 *   - the device's exact serial is on WIPEABLE_TEST_DEVICES below (agreed with Frits, changed only by a reviewed PR);
 *   - the run names that serial in `E2E_WIPE_OK` (comma-separated), so no run wipes a phone by accident.
 * A personal phone is never on the list, and PERSONAL_PHONES refuses it even if someone names it.
 */
// The Samsung A33 kept for tests (Frits 2026-11-16: both agents may use it, wipes included).
const WIPEABLE_TEST_DEVICES = Object.freeze(['RFCT504SRZH']);
// Frits's own Fairphone: his daily phone. Never wiped by a walk, whatever a run says.
const PERSONAL_PHONES = Object.freeze(['c53828f5']);

function mayWipe(deviceId, env = process.env) {
  const id = String(deviceId ?? '');
  if (id.startsWith('emulator-')) return true;
  if (!id || PERSONAL_PHONES.includes(id) || !WIPEABLE_TEST_DEVICES.includes(id)) return false;
  const named = String(env?.E2E_WIPE_OK ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return named.includes(id);
}

module.exports = { mayWipe, WIPEABLE_TEST_DEVICES, PERSONAL_PHONES };
