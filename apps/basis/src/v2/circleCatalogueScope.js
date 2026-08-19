// circleCatalogueScope.js — per-circle CATALOGUE scoping (PLAN-manifest-gate-surfaces Part D).
// (Distinct from circleScope.js, which scopes ITEMS by circle id — itemCircleId/isInCircle/scopeItems.)
//
// The circle bot's LLM should choose its tool from the circle's APPS, not from every app's ops. The
// device run mis-picked basis's `/me` out of 125 flat ops; scoping the tool list to the circle
// apps removes that whole class (and aligns the LLM's options with what the circle actually dispatches
// — `makeResolvingCallSkill` already resolves to `DEFAULT_CIRCLE_ORIGINS`). Because every surface is a
// projection of this catalogue, the same scope narrows the LLM tools today and the gate/slash later.
//
// Default scope = `DEFAULT_CIRCLE_ORIGINS` (the 5 circle apps — drops basis's account/transport
// infra ops). A per-circle `policy.apps` array narrows further (e.g. a household circle → ['household',
// 'tasks']). Pure: returns a new catalogue object reusing the original's helpers; opsById/commandMenu
// filtered by `appOrigin`.

import { DEFAULT_CIRCLE_ORIGINS } from './circleSources.js';

/**
 * @param {{opsById?:Map<string,{op:object,appOrigin:string}>, commandMenu?:Array}} catalogue
 * @param {string[]} [apps]  allowed app origins; falsy → DEFAULT_CIRCLE_ORIGINS
 * @returns {object} a scoped catalogue (or the original if it has no opsById)
 */
export function scopeCatalogueToApps(catalogue, apps) {
  if (!catalogue || !catalogue.opsById || typeof catalogue.opsById.forEach !== 'function') return catalogue;
  const allow = new Set(Array.isArray(apps) && apps.length ? apps : DEFAULT_CIRCLE_ORIGINS);
  const opsById = new Map();
  for (const [k, entry] of catalogue.opsById) if (allow.has(entry && entry.appOrigin)) opsById.set(k, entry);
  const commandMenu = Array.isArray(catalogue.commandMenu)
    ? catalogue.commandMenu.filter((e) => allow.has(e && e.appOrigin))
    : catalogue.commandMenu;
  return { ...catalogue, opsById, commandMenu };
}
