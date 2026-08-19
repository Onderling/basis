/**
 * followUp — step 4 single-field follow-up state machine.
 *
 * Captures the on-device bug from 2026-05-26: tapping `[Help with]`
 * on a stoop post produced a red "couldn't run that command" bubble
 * because respondToItem requires both itemId AND body, but the
 * row-tap only synthesizes itemId → resolveDispatch returns
 * needsForm → the old `else` branch in ChatScreen produced a generic
 * error.  Tests pin the contract that beginFollowUp + completeFollowUp
 * together produce a runnable dispatch.
 */
import { describe, it, expect } from 'vitest';
import {
  beginFollowUp, completeFollowUp, pickPromptKey,
  beginFormFollowUp, completeMultiFieldFollowUp,
} from '../src/core/followUp.js';

/** The exact shape resolveDispatch returns for `respondToItem` when
 *  the row-tap binds only itemId. */
function makeNeedsFormDispatch() {
  return {
    kind:         'needsForm',
    opId:         'respondToItem',
    appOrigin:    'stoop',
    threadId:     null,
    replyShape:   'text',
    missing:      ['body'],
    prefilledArgs:{ itemId: 'post-42' },
    params:       [
      { name: 'itemId', kind: 'string', required: true },
      { name: 'body',   kind: 'string', required: true },
    ],
  };
}

/** Stub localiser — returns key + any interpolation values so tests
 *  can assert both that the key was looked up + that params landed. */
const stubT = (key, params = {}) => {
  const tail = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return tail ? `[${key}](${tail})` : `[${key}]`;
};

describe('#253 step 4 — beginFollowUp', () => {
  it('captures the pending state when dispatch is needsForm with single missing param', () => {
    const pending = beginFollowUp({
      dispatch:        makeNeedsFormDispatch(),
      originMessageId: 'm5',
      t:               stubT,
    });
    expect(pending).toBeTruthy();
    expect(pending.opId).toBe('respondToItem');
    expect(pending.appOrigin).toBe('stoop');
    expect(pending.missingParam).toBe('body');
    expect(pending.prefilledArgs).toEqual({ itemId: 'post-42' });
    expect(pending.originMessageId).toBe('m5');
    // The prompt comes from the localiser.  Stub returns the key
    // plus interpolations.
    expect(pending.promptText).toContain('chat.followup_prompt');
    expect(pending.promptText).toContain('respondToItem');
    expect(pending.promptText).toContain('body');
  });

  it('returns null when dispatch is not needsForm', () => {
    expect(beginFollowUp({ dispatch: null,             t: stubT })).toBeNull();
    expect(beginFollowUp({ dispatch: { kind: 'ready' }, t: stubT })).toBeNull();
    expect(beginFollowUp({ dispatch: { kind: 'unknown' }, t: stubT })).toBeNull();
  });

  it('returns null when more than one param is missing (V1 single-field only)', () => {
    const d = makeNeedsFormDispatch();
    d.missing = ['itemId', 'body'];
    expect(beginFollowUp({ dispatch: d, t: stubT })).toBeNull();
  });
});

describe('#253 step 4 — completeFollowUp', () => {
  it('merges the user response into the prefilled args + flips to ready', () => {
    const pending = beginFollowUp({
      dispatch:        makeNeedsFormDispatch(),
      originMessageId: 'm5',
      t:               stubT,
    });
    const ready = completeFollowUp({ pending, text: 'I can lend my ladder' });
    expect(ready.kind).toBe('ready');
    expect(ready.opId).toBe('respondToItem');
    expect(ready.appOrigin).toBe('stoop');
    expect(ready.threadId).toBeNull();
    expect(ready.replyShape).toBe('text');
    expect(ready.args).toEqual({
      itemId: 'post-42',
      body:   'I can lend my ladder',
    });
  });

  it('throws when pending is missing', () => {
    expect(() => completeFollowUp({ pending: null, text: 'x' })).toThrow(/pending required/);
  });

  it('coerces non-string responses to string', () => {
    const pending = beginFollowUp({
      dispatch: makeNeedsFormDispatch(), t: stubT,
    });
    const ready = completeFollowUp({ pending, text: 42 });
    expect(ready.args.body).toBe('42');
  });
});

describe('#253 step 6 — beginFormFollowUp', () => {
  function makeMultiNeedsForm() {
    return {
      kind:         'needsForm',
      opId:         'composePost',
      appOrigin:    'stoop',
      threadId:     null,
      replyShape:   'text',
      missing:      ['title', 'body'],
      prefilledArgs:{ audience: 'circle' },
      params:       [
        { name: 'audience', kind: 'string', required: true },
        { name: 'title',    kind: 'string', required: true },
        { name: 'body',     kind: 'string', required: true },
      ],
    };
  }

  it('returns a multi-field pending shape for needsForm with >= 2 missing params', () => {
    const pending = beginFormFollowUp({
      dispatch:        makeMultiNeedsForm(),
      originMessageId: 'm9',
      t:               stubT,
    });
    expect(pending).toBeTruthy();
    expect(pending.kind).toBe('multi');
    expect(pending.opId).toBe('composePost');
    expect(pending.fields).toHaveLength(2);
    expect(pending.fields.map((f) => f.name)).toEqual(['title', 'body']);
    expect(pending.prefilledArgs).toEqual({ audience: 'circle' });
    expect(pending.originMessageId).toBe('m9');
    // Each field has a label resolved via t() (stubT echoes the key).
    expect(pending.fields[1].label).toContain('chat.form_label_body');
  });

  it('returns null when dispatch has only one missing param (single-field path owns that)', () => {
    const d = makeMultiNeedsForm();
    d.missing = ['body'];
    expect(beginFormFollowUp({ dispatch: d, t: stubT })).toBeNull();
  });

  it('returns null for non-needsForm dispatches', () => {
    expect(beginFormFollowUp({ dispatch: null,                  t: stubT })).toBeNull();
    expect(beginFormFollowUp({ dispatch: { kind: 'ready' },     t: stubT })).toBeNull();
    expect(beginFormFollowUp({ dispatch: { kind: 'unknown' },   t: stubT })).toBeNull();
  });
});

describe('#253 step 6 — completeMultiFieldFollowUp', () => {
  function makePending() {
    return {
      kind:         'multi',
      opId:         'composePost',
      appOrigin:    'stoop',
      threadId:     null,
      replyShape:   'text',
      prefilledArgs:{ audience: 'circle' },
      fields: [
        { name: 'title', kind: 'string', label: 'Title' },
        { name: 'body',  kind: 'string', label: 'Body'  },
      ],
    };
  }

  it('merges field values into the prefilled args + flips to ready', () => {
    const ready = completeMultiFieldFollowUp({
      pending: makePending(),
      values:  { title: 'Need a ladder', body: 'Anyone got one to borrow?' },
    });
    expect(ready.kind).toBe('ready');
    expect(ready.opId).toBe('composePost');
    expect(ready.args).toEqual({
      audience: 'circle',
      title:    'Need a ladder',
      body:     'Anyone got one to borrow?',
    });
  });

  it('coerces missing values to empty string (caller validates)', () => {
    const ready = completeMultiFieldFollowUp({
      pending: makePending(),
      values:  { title: 'X' },              // body absent
    });
    expect(ready.args.body).toBe('');
  });

  it('throws when pending is missing', () => {
    expect(() => completeMultiFieldFollowUp({ pending: null, values: {} }))
      .toThrow(/pending required/);
  });
});

describe('#253 step 4 polish — op-specific prompts', () => {
  it('pickPromptKey returns the op-specific key for respondToItem.body', () => {
    expect(pickPromptKey('respondToItem', 'body')).toBe(
      'chat.followup_prompt_respond_to_item_body',
    );
  });

  it('pickPromptKey falls back to the generic key for unknown ops', () => {
    expect(pickPromptKey('someUnknownOp',  'body')).toBe('chat.followup_prompt');
    expect(pickPromptKey('respondToItem',  'id'  )).toBe('chat.followup_prompt');
    expect(pickPromptKey('claimTask',      'id'  )).toBe('chat.followup_prompt');
  });

  it('beginFollowUp routes respondToItem.body through the op-specific key', () => {
    const pending = beginFollowUp({
      dispatch: makeNeedsFormDispatch(),    // opId=respondToItem, missing=['body']
      t:        stubT,
    });
    // stubT echoes the key, so the op-specific routing is visible
    // in the prompt text.
    expect(pending.promptText).toContain('chat.followup_prompt_respond_to_item_body');
    expect(pending.promptText).not.toContain('chat.followup_prompt(');
  });
});
