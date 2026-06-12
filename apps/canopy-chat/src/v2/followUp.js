/**
 * Conversational follow-up state machine for `needsForm` dispatches — SHARED (web + mobile).
 *
 * Lifted from mobile's `core/followUp.js` (it was always pure / no-RN / no-DOM) so BOTH the classic
 * mobile chat AND the v2 kring composers (web `circleApp.js` + mobile `CircleLauncherScreen.js`) elicit
 * a missing field the same chat-native way, from one source — instead of web popping a modal form and
 * mobile asking inline (which would diverge). The mobile package re-exports these from the barrel for
 * back-compat, so existing importers (`core/followUp.js`) are unchanged.
 *
 * When a dispatch is `needsForm` (an op needs more args than were bound — e.g. `respondToItem` needs
 * both `itemId` AND `body`), the surface:
 *   1. needsForm → `beginFollowUp({dispatch, t})` captures which param to ask for + the partial dispatch
 *   2. renders a bot bubble with a localised prompt ("What's your {param}?")
 *   3. the user's NEXT message goes through `completeFollowUp({pending, text})` instead of parse/dispatch
 *   4. that returns a `ready` dispatch; the surface runs it through its normal pipeline; clears pending
 *
 * `beginFormFollowUp` / `completeMultiFieldFollowUp` handle the 2+-missing case (mobile renders it as an
 * inline multi-field form bubble; web kring keeps the simpler single-field path + a fallback for now).
 * Both pending shapes carry a `kind` discriminator so consumers branch cleanly.
 *
 * Pure / portable — no RN, no DOM. The surface owns its pending state; this module owns the transitions.
 */

/**
 * @typedef {object} PendingFollowUp
 * @property {'single'}            kind             discriminator (always 'single' here)
 * @property {string}              opId
 * @property {string}              appOrigin
 * @property {string|null}         threadId
 * @property {string}              replyShape
 * @property {Object<string, any>} prefilledArgs    args already filled by the tap
 * @property {string}              missingParam     the param name awaiting user input
 * @property {string}              promptText       what to show the user
 * @property {string|null}         originMessageId  for state-morphing the source bubble after the dispatch
 */

/**
 * @typedef {object} FormFieldSpec
 * @property {string}        name        param name
 * @property {string}        kind        'string' | 'enum' | 'number' | ...
 * @property {string}        label       what to render above the TextInput
 * @property {string}        [placeholder]
 * @property {Array<string>} [enumValues]
 *
 * @typedef {object} PendingFormFollowUp
 * @property {'multi'}              kind             discriminator
 * @property {string}               opId
 * @property {string}               appOrigin
 * @property {string|null}          threadId
 * @property {string}               replyShape
 * @property {Object<string, any>}  prefilledArgs    args bound by the row-tap
 * @property {Array<FormFieldSpec>} fields           ordered missing params to collect
 * @property {string}               title            bubble title
 * @property {string|null}          originMessageId
 */

/**
 * Per-op natural-language prompts. Keyed `<opId>.<missingParam>`. Missing entries fall back to the
 * generic `chat.followup_prompt` ("What's your {{param}}?"). Locale entries with these keys MUST exist
 * in both en + nl bundles — `pickPromptKey` returns the key, not the resolved string.
 */
const SPECIFIC_PROMPT_KEYS = {
  'respondToItem.body': 'chat.followup_prompt_respond_to_item_body',
};

/**
 * Pick the locale key for a followup prompt. Op-specific keys win over the generic fallback. Pure.
 * @param {string} opId
 * @param {string} missingParam
 * @returns {string}    locale key to pass to t()
 */
export function pickPromptKey(opId, missingParam) {
  return SPECIFIC_PROMPT_KEYS[`${opId}.${missingParam}`] ?? 'chat.followup_prompt';
}

/**
 * Build a PendingFollowUp from a needsForm dispatch + the localiser. Returns null when the dispatch
 * isn't a needsForm or has more than one missing required param (use `beginFormFollowUp` for multi).
 * @param {{dispatch: object, originMessageId?: string, t: function}} args
 * @returns {PendingFollowUp|null}
 */
export function beginFollowUp({ dispatch, originMessageId, t }) {
  if (!dispatch || dispatch.kind !== 'needsForm') return null;
  const missing = Array.isArray(dispatch.missing) ? dispatch.missing : [];
  if (missing.length !== 1) return null;     // multi-missing → use beginFormFollowUp
  const missingParam = missing[0];
  const promptKey = pickPromptKey(dispatch.opId, missingParam);
  return {
    kind:            'single',
    opId:            dispatch.opId,
    appOrigin:       dispatch.appOrigin,
    threadId:        dispatch.threadId ?? null,
    replyShape:      dispatch.replyShape ?? 'text',
    prefilledArgs:   { ...(dispatch.prefilledArgs ?? {}) },
    missingParam,
    promptText:      t(promptKey, { opId: dispatch.opId, param: missingParam }),
    originMessageId: originMessageId ?? null,
  };
}

/**
 * Build a `PendingFormFollowUp` from a needsForm dispatch with 2+ missing required params. Returns null
 * when the dispatch isn't a multi-field needsForm.
 * @param {{dispatch: object, originMessageId?: string, t: function}} args
 * @returns {PendingFormFollowUp|null}
 */
export function beginFormFollowUp({ dispatch, originMessageId, t }) {
  if (!dispatch || dispatch.kind !== 'needsForm') return null;
  const missing = Array.isArray(dispatch.missing) ? dispatch.missing : [];
  if (missing.length < 2) return null;
  const paramsByName = new Map(
    (Array.isArray(dispatch.params) ? dispatch.params : []).map((p) => [p.name, p]),
  );
  const fields = missing.map((name) => {
    const spec = paramsByName.get(name) ?? {};
    const labelKey = `chat.form_label_${name}`;
    const label = t(labelKey) || name;
    return {
      name,
      kind:        spec.kind ?? 'string',
      label,
      enumValues:  Array.isArray(spec.values) ? spec.values : undefined,
    };
  });
  return {
    kind:            'multi',
    opId:            dispatch.opId,
    appOrigin:       dispatch.appOrigin,
    threadId:        dispatch.threadId ?? null,
    replyShape:      dispatch.replyShape ?? 'text',
    prefilledArgs:   { ...(dispatch.prefilledArgs ?? {}) },
    fields,
    title:           t('chat.form_title', { opId: dispatch.opId }),
    originMessageId: originMessageId ?? null,
  };
}

/**
 * Combine a `PendingFormFollowUp` with the user's form values into a ready dispatch.
 * @param {{pending: PendingFormFollowUp, values: Object<string, any>}} args
 * @returns {object} ready dispatch
 */
export function completeMultiFieldFollowUp({ pending, values }) {
  if (!pending) throw new TypeError('completeMultiFieldFollowUp: pending required');
  const collected = {};
  for (const f of pending.fields ?? []) {
    collected[f.name] = String(values?.[f.name] ?? '');
  }
  return {
    kind:       'ready',
    opId:       pending.opId,
    args:       { ...pending.prefilledArgs, ...collected },
    appOrigin:  pending.appOrigin,
    threadId:   pending.threadId,
    replyShape: pending.replyShape,
  };
}

/**
 * Combine a PendingFollowUp with the user's response text into a ready dispatch.
 * @param {{pending: PendingFollowUp, text: string}} args
 * @returns {object} ready dispatch
 */
export function completeFollowUp({ pending, text }) {
  if (!pending) throw new TypeError('completeFollowUp: pending required');
  const args = {
    ...pending.prefilledArgs,
    [pending.missingParam]: String(text ?? ''),
  };
  return {
    kind:       'ready',
    opId:       pending.opId,
    args,
    appOrigin:  pending.appOrigin,
    threadId:   pending.threadId,
    replyShape: pending.replyShape,
  };
}
