/**
 * Shared test helpers.  Lifted 2026-05-06 from duplicates across
 * phase3/4/9 + web tests so future tests pull one shape.
 */

import { DataPart } from '@onderling/core';

/** Invoke a registered skill on an agent, simulating a caller `from`. */
export async function callSkill(agent, skillId, args, fromWebid) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

/**
 * Build a deterministic fake clock + setTimeout/clearTimeout pair.
 * Advance steps to each timer's fireAt so handlers that schedule new
 * timers see the correct `now`.  Mirrors the notifier's test pattern.
 */
export function buildFakeClock(initial = 0) {
  let now = initial;
  const timers = [];
  const setTimeoutFn = (fn, delay) => {
    const id = timers.length;
    timers.push({ fn, fireAt: now + delay, cancelled: false });
    return id;
  };
  const clearTimeoutFn = (id) => { if (timers[id]) timers[id].cancelled = true; };
  const advance = async (ms) => {
    const target = now + ms;
    while (true) {
      let next = null;
      for (const t of timers) {
        if (!t.cancelled && t.fireAt <= target && (next == null || t.fireAt < next.fireAt)) next = t;
      }
      if (!next) break;
      if (next.fireAt > now) now = next.fireAt;
      next.cancelled = true;
      await next.fn();
    }
    now = target;
  };
  return {
    advance,
    setTimeoutFn,
    clearTimeoutFn,
    getNow: () => now,
    setNow: (v) => { now = v; },
  };
}

/**
 * REST-shaped skill invocation against a `mountLocalUi` server.
 * Used by web.test.js — no envelope wrapping; same A2A surface
 * the browser uses.
 *
 * @param {string} baseUrl
 * @param {string} skillId
 * @param {object} data
 */
export async function callRest(baseUrl, skillId, data) {
  const res = await fetch(`${baseUrl}/tasks/send`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ skillId, message: { parts: [{ type: 'DataPart', data }] } }),
  });
  if (!res.ok) throw new Error(`${skillId}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== 'completed') throw new Error(`${skillId}: ${json.status}`);
  return (json.artifacts?.[0]?.parts ?? []).find(p => p?.type === 'DataPart')?.data ?? {};
}
