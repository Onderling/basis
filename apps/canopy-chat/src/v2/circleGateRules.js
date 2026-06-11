// circleGateRules.js — the default deterministic rule set for the circle bot's token gate
// (createTokenGate). These route the most common task verbs WITHOUT calling the LLM: a small local
// model choosing from the ~125-op aggregate catalog is unreliable (the device run mapped "add milk to
// the list" → the wrong op), but "add X" / "done X" / "claim X" are unambiguous and cheap to match.
//
// Each rule returns a structured `{opId, args}` that flows through the SAME dispatch + clarifying
// resolution as an LLM- or slash-derived command:
//   • add   → addTask{text}            — `text` is a plain param: the item passes straight through.
//   • done  → completeTask{id:label}   — `id` is pickerSource-backed (listMine): the clarifying
//   • claim → claimTask{id:label}        dispatch resolves the label → the real task id, circle-scoped
//                                         (unique → run · ambiguous → ask with buttons · none → ask).
// A rule whose extraction fails returns null → it falls through to the next rule / the LLM. Bilingual
// (en + nl) on the common forms; anything unmatched still reaches the model. English-first.

/** Target after a verb: the rest of the line, minus a trailing "to/aan/op <list>" qualifier. */
function targetAfter(text, verbRe) {
  const m = String(text).match(verbRe);
  if (!m || !m[1]) return '';
  return m[1].replace(/\s+(?:to|aan|op|in)\b.*$/i, '').trim();
}

/**
 * @param {{ addOp?:string, doneOp?:string, claimOp?:string }} [opts]  op-id overrides (defaults match
 *        the tasks manifest the circle bot dispatches against)
 * @returns {Array<{name:string, test:RegExp, command:(text:string)=>({opId:string,args:object}|null)}>}
 */
export function defaultCircleGateRules({ addOp = 'addTask', doneOp = 'completeTask', claimOp = 'claimTask' } = {}) {
  return [
    {
      name: 'add-task',
      // en: add / new task / todo …   nl: voeg … toe / nieuwe taak / zet … op de lijst
      test: /^(?:add|new task|todo|voeg|nieuwe taak|maak (?:een )?taak|zet)\b/i,
      command: (text) => {
        const item =
          targetAfter(text, /^(?:add|todo|new task)\s+(.+)$/i) ||
          targetAfter(text, /^(?:voeg|zet)\s+(.+?)(?:\s+toe)?$/i) ||
          targetAfter(text, /^(?:maak (?:een )?taak|nieuwe taak)\s+(.+)$/i);
        return item ? { opId: addOp, args: { text: item } } : null;
      },
    },
    {
      name: 'complete-task',
      // en: done / complete(d) / finished / mark X done   nl: klaar (met) / voltooid / gedaan
      test: /^(?:done|complete|completed|finished|mark|klaar|voltooid|gedaan)\b/i,
      command: (text) => {
        const label =
          targetAfter(text, /^(?:done|completed?|finished|voltooid|gedaan)\s+(?:with\s+|met\s+)?(.+)$/i) ||
          targetAfter(text, /^mark\s+(.+?)\s+(?:as\s+)?done$/i) ||
          targetAfter(text, /^klaar\s+(?:met\s+)?(.+)$/i);
        return label ? { opId: doneOp, args: { id: label } } : null;
      },
    },
    {
      name: 'claim-task',
      // en: claim / I'll do|take X   nl: claim / ik doe|pak X / pak … op
      test: /^(?:claim|i'?ll (?:do|take)|i will (?:do|take)|ik (?:doe|pak|neem)|pak)\b/i,
      command: (text) => {
        const label =
          targetAfter(text, /^(?:claim|pak)\s+(.+)$/i) ||
          targetAfter(text, /^(?:i'?ll|i will)\s+(?:do|take)\s+(.+)$/i) ||
          targetAfter(text, /^ik\s+(?:doe|pak|neem)\s+(.+)$/i);
        return label ? { opId: claimOp, args: { id: label } } : null;
      },
    },
  ];
}
