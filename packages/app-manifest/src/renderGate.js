/**
 * Render a manifest (or several) into deterministic token-gate RULES — the pre-LLM half of a chat
 * surface's routing. This is the shared projection behind both household's TG-bot and canopy-chat's
 * circle bot: instead of hand-written verb rules, the gate comes from each app's manifest, the same
 * source `renderSlash` / `renderChat` already project.
 *
 * `renderSlash` is the matcher (declared verbs → a command); this wraps it into the rule shape a
 * token-gate engine consumes — `{ name, test, command }`, where `command(text)` returns
 * `{ opId, args } | null` (null → the engine falls through to the next rule / the LLM). Trying each
 * manifest's matcher as its own rule preserves declaration order and first-match-wins across apps.
 *
 * Field note: `renderSlash` emits `skillId` (the op id); the gate + dispatch use `opId`. Same value,
 * normalized here. Multi-item bodies (`splitItems`) yield an array from `renderSlash`; a single-command
 * gate dispatches the FIRST (multi-dispatch is a deliberate follow-up — see circle bot wiring).
 *
 * @param {import('./schema.js').Manifest | import('./schema.js').Manifest[]} manifestOrList
 * @returns {Array<{ name:string, test:()=>boolean, command:(text:string)=>({opId:string,args:object}|null) }>}
 */
import { renderSlash } from './renderSlash.js';

// opts ({ locale, trailLexicon }) is forwarded to renderSlash to enable the per-locale TRAILING-verb
// pass ("X done" / "afwas klaar"); inert when omitted, so existing callers are unchanged.
export function renderGate(manifestOrList, opts = {}) {
  const manifests = Array.isArray(manifestOrList) ? manifestOrList : [manifestOrList];
  return manifests.filter(Boolean).map((manifest, i) => {
    const matcher = renderSlash(manifest, opts);
    const name = `manifest:${manifest.appId ?? manifest.id ?? i}`;
    return {
      name,
      test: () => true,                                  // always attempt; `command` decides via parse
      command: (text) => {
        const r = matcher.parse(text);
        if (!r) return null;                             // no declared verb matched → next rule / LLM
        const call = Array.isArray(r) ? r[0] : r;        // single-command dispatch; multi is a follow-up
        return call ? { opId: call.skillId, args: call.args } : null;
      },
    };
  });
}
