// The owner grants an agent the node's agenda files, as a test drives it: the owner's device statement on
// `grants.mint`, the tokens received by that agent over the relay (the one-way grant message), one per op.
import { Parts } from '@onderling/core';
import { GRANT_DELIVERY_SUBTYPE } from '../../src/grants.js';

/**
 * @param {object} host      the started companion
 * @param {{auth: Function}} owner   the owner's device (`ownerDevice`)
 * @param {import('@onderling/core').Agent} agent   the agent granted (hello'd to the node); it also carries the request
 * @returns {Promise<{put: object, drop: object}>} the two tokens, as received
 */
export async function grantAgendaFiles(host, owner, agent) {
  const node = host.agent.address;
  const got = new Promise((resolve) => {
    const on = (m) => { if (m?.from === node && m?.payload?.subtype === GRANT_DELIVERY_SUBTYPE) { agent.off?.('message', on); resolve(m.payload.tokens); } };
    agent.on('message', on);
  });
  const args = { to: agent.pubKey, families: ['agenda-files'] };
  const r = Parts.data(await agent.invoke(node, 'grants.mint', { ...args, auth: owner.auth(node, 'grants.mint', args) }));
  if (r?.ok !== true) throw new Error(`grants.mint refused: ${JSON.stringify(r)}`);
  const tokens = await got;
  return { put: tokens.find((t) => t.skill === 'feed.put'), drop: tokens.find((t) => t.skill === 'feed.drop') };
}
