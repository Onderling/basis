// tokenGate.js — minimize LLM calls for the circle bot. Before a turn reaches the (possibly remote)
// LLM, run cheap LOCAL checks first:
//   1. RULES — a clear match either SKIPS (this turn isn't for the bot → no LLM at all) or ROUTES a
//      command directly (an obvious command → dispatch without the LLM).
//   2. otherwise → hand off to the LLM, but attach RAG CONTEXT retrieved from a (sealed) index, so the
//      prompt carries only the few relevant items instead of the whole circle (fewer tokens).
//
// "Run the gate locally even when the LLM is remote" — rules + retrieval are local; only the residue
// hits the model. Pairs with `sealedIndex.semanticQuery` as the retriever (P2 local search).

/**
 * @param {object} a
 * @param {Array<{ name?:string, test:RegExp|Function, command?:(text:string,ctx:object)=>({opId:string,args?:object}|null), reason?:string }>} [a.rules]
 *        ordered rules; first match wins. A rule with `command` ROUTES (returns `{opId,args}`); without
 *        `command` it SKIPS the LLM. A `command` that returns null falls through to the next rule / LLM.
 * @param {(text:string, ctx:object)=>any[]|Promise<any[]>} [a.retrieve]  RAG retriever (e.g. semanticQuery)
 * @param {number} [a.maxContext]  cap on retrieved context items (default 5)
 */
export function createTokenGate({ rules = [], retrieve, maxContext = 5 } = {}) {
  const ruleList = Array.isArray(rules) ? rules : [];
  return {
    /** @returns {Promise<{via:'skip'|'rule'|'llm', command?, context?, reason?, rule?}>} */
    async evaluate(text, ctx = {}) {
      const trimmed = String(text ?? '').trim();
      if (!trimmed) return { via: 'skip', reason: 'empty' };

      for (const rule of ruleList) {
        if (!ruleMatches(rule, trimmed, ctx)) continue;
        if (typeof rule.command === 'function') {
          const cmd = rule.command(trimmed, ctx);
          if (cmd && cmd.opId) return { via: 'rule', command: { opId: cmd.opId, args: cmd.args || {} }, rule: rule.name };
          continue;                                   // matched but couldn't build a command → fall through
        }
        return { via: 'skip', reason: rule.reason || rule.name || 'rule' };
      }

      const context = typeof retrieve === 'function'
        ? ((await retrieve(trimmed, ctx)) || []).slice(0, Math.max(0, maxContext))
        : [];
      return { via: 'llm', context };
    },
  };
}

function ruleMatches(rule, text, ctx) {
  if (!rule || rule.test == null) return false;
  if (rule.test instanceof RegExp) return rule.test.test(text);
  if (typeof rule.test === 'function') return !!rule.test(text, ctx);
  return false;
}
