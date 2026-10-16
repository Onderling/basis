/**
 * A new persona, as the person makes it: its name, and their answer to "what you offer — also as <name>?" (default
 * no). The answer is kept on the persona as its own marker (`OFFERINGS_INHERIT_KEY`); the agents core gives a new
 * persona the "no" when nothing is said, so only a "yes" needs saying. Both shells build the call here.
 */
import { OFFERINGS_INHERIT_KEY } from '@onderling/agent-registry';

/**
 * The `createProfile` args for a new persona.
 * @param {string} name
 * @param {{takeOfferings?: boolean}} [o]   true: the general persona's offerings are this persona's too
 * @returns {{name: string, properties?: string}}
 */
export function newPersonaArgs(name, { takeOfferings = false } = {}) {
  const args = { name: String(name ?? '').trim() };
  if (takeOfferings === true) args.properties = JSON.stringify({ [OFFERINGS_INHERIT_KEY]: { mode: 'own', value: true } });
  return args;
}
