/**
 * The own-devices store — a host's OWN typed items: not a circle's, a person's (or a bot's) across their own devices.
 *
 * Keyed by the own-devices scope (the scope the grants lane already rides between a person's enrolled devices), so
 * that when it fans it reaches exactly those devices — a person's phone and web app, a bot and its companion — without
 * a rename or a move. Today it fans to nobody: the box is one device. On a household bot it holds the bot's own rows
 * and the rows of the people it is the device for (a Telegram-only person has no device of their own). Sealed at rest
 * like every content store on the box.
 *
 * It is NOT a second circle store (the one-store-per-circle rule names this module as an allowed constructor for that
 * reason): no circle owns it, and nothing in it ever reaches a circle's members.
 */
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { validate } from '@onderling/item-types';
import { OWN_DEVICES_SCOPE } from './grantsManifest.js';

/**
 * @param {object} [a]
 * @param {object|null} [a.dataSource]  the persistence seam (a sealed file on the box); null → in memory
 * @returns {import('@onderling/item-store').CircleItemStore}
 */
export function createOwnDevicesStore({ dataSource = null } = {}) {
  // validated against the dictionary: a row that is not a well-formed item never lands
  return createCircleStores({ dataSource: dataSource ?? memoryDataSource(), registry: { validate }, rootPrefix: 'mem://own/' }).getStore(OWN_DEVICES_SCOPE);
}
