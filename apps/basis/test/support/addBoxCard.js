// A person adds a box's printed card to their book, as they would from its QR — so the box is a contact whose card says
// it is a bot, and their app signs the `/start <code>` they then type to it (the admission is their own signed act).
/**
 * The box is up AND has printed its card. `device-runner: up` comes a few lines BEFORE the card, in its own write, so a
 * reader that waits for "up" alone can read the output between the two and find no card ("Cannot read properties of
 * null (reading 1)", screen-admin-box, 2026-11-17). Every box spec waits for this instead.
 */
export function boxIsUp(stdout) {
  const s = String(stdout ?? '');
  return s.includes('device-runner: up') && /onderling-contact:\/\/[A-Za-z0-9_-]+\s/.test(s);
}

export async function addBoxCard(node, stdout) {
  const uri = /onderling-contact:\/\/[A-Za-z0-9_-]+/.exec(String(stdout ?? ''))?.[0];
  if (!uri) throw new Error('addBoxCard: the box printed no card');
  const r = await node.agent.callSkill('pinboard', 'addContactFromQr', { payload: uri });
  if (r?.error || r?.ok === false) throw new Error(`addBoxCard: the card was not added (${JSON.stringify(r)})`);
  return r;
}
