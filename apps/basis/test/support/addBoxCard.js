// A person adds a box's printed card to their book, as they would from its QR — so the box is a contact whose card says
// it is a bot, and their app signs the `/start <code>` they then type to it (the admission is their own signed act).
export async function addBoxCard(node, stdout) {
  const uri = /onderling-contact:\/\/[A-Za-z0-9_-]+/.exec(String(stdout ?? ''))?.[0];
  if (!uri) throw new Error('addBoxCard: the box printed no card');
  const r = await node.agent.callSkill('stoop', 'addContactFromQr', { payload: uri });
  if (r?.error || r?.ok === false) throw new Error(`addBoxCard: the card was not added (${JSON.stringify(r)})`);
  return r;
}
