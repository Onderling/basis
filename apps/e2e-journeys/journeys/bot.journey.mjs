// J-bot: a bot/agent added to a shared circle with a CUSTOM NAME, discovered by
// MULTIPLE USERS from one shared registry, and invoked by each over the relay.
// Exercises @onderling/agent-registry (registerAgentBundle's `name` + list/lookup)
// + the multi-user "everyone sees the same bot" property. (6b. The parked SP-5b
// circle-NAME resolver is deliberately NOT built here — this is the BOT's name.)
import { Agent, AgentIdentity, TextPart, Parts } from '@onderling/core';
import { VaultMemory }        from '@onderling/vault';
import { RelayTransport }     from '@onderling/transports';
import { registerAgentBundle, createAgentRegistry } from '../../../packages/agent-registry/index.js';
import { wait, checker }      from './_util.mjs';

export const name = 'J-bot (named bot in a shared circle, multi-user)';

// A minimal in-memory pseudoPod: the shared registry resource lives in this Map,
// so every user reading it sees the same circle registry.
function makePseudoPod() {
  const m = new Map();
  return {
    async read(uri)  { return m.has(uri) ? { bytes: m.get(uri), etag: null } : null; },
    async write(uri, body) { m.set(uri, body); return { etag: null }; },
  };
}

export async function run({ relayUrl }) {
  const { results, check } = checker();
  const BOT_NAME = 'Circlebot';
  const DEVICE = 'shared-circle-registry';

  const mk = async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    return new Agent({ identity: id, transport: new RelayTransport({ relayUrl, identity: id }) });
  };
  const bot   = await mk();
  const userA = await mk();
  const userB = await mk();

  // The bot does something with input (a neighbourhood helper).
  bot.register('ask', async ({ parts }) => [TextPart(`${BOT_NAME} hoorde: ${Parts.text(parts)}`)]);

  try {
    for (const a of [bot, userA, userB]) await a.start();
    await wait(1500);
    check('bot + two users on the relay',
      bot.transport.connected && userA.transport.connected && userB.transport.connected);

    // The bot is added to the shared circle registry with a CUSTOM NAME.
    const sharedPod = makePseudoPod();
    const handle = await registerAgentBundle({
      pseudoPod: sharedPod, podDeviceId: DEVICE, agent: bot,
      opts: { name: BOT_NAME, capabilities: ['ask'] },
    });
    check('bot registered in the circle registry with a custom name', !!handle);

    // Each user independently reads the SAME registry and discovers the bot.
    const discover = async () => {
      const reg = createAgentRegistry({ pseudoPod: sharedPod, deviceId: DEVICE });
      return (await reg.list()).find((e) => e.name === BOT_NAME);
    };
    const seenA = await discover();
    const seenB = await discover();
    check('user A discovers the bot by its custom name', seenA?.name === BOT_NAME && typeof seenA?.pubKey === 'string');
    check('user B discovers the SAME bot (shared circle view)', seenB?.pubKey === seenA?.pubKey && seenB?.name === BOT_NAME);
    check('the bot the users discovered IS the bot on the relay', seenA?.pubKey === bot.address);
    check('the registry entry carries the bot capabilities', Array.isArray(seenA?.capabilities) && seenA.capabilities.includes('ask'));

    // Both users invoke the discovered bot over the relay — multiple users, one bot.
    // In a circle the bot + members are mutual peers (the bot must know a caller's
    // key to sign its reply back).
    userA.addPeer(seenA.pubKey, seenA.pubKey);
    userB.addPeer(seenB.pubKey, seenB.pubKey);
    bot.addPeer(userA.address, userA.address);
    bot.addPeer(userB.address, userB.address);
    const rA = Parts.text(await userA.invoke(seenA.pubKey, 'ask', [TextPart('wanneer is de vuilnisophaal?')]));
    const rB = Parts.text(await userB.invoke(seenB.pubKey, 'ask', [TextPart('mag ik een boormachine lenen?')]));
    check('user A invokes the bot and gets a reply', rA === `${BOT_NAME} hoorde: wanneer is de vuilnisophaal?`);
    check('user B invokes the SAME bot and gets a reply (multi-user)', rB === `${BOT_NAME} hoorde: mag ik een boormachine lenen?`);
  } finally {
    for (const a of [bot, userA, userB]) await a.transport.disconnect().catch(() => {});
  }
  return results;
}
