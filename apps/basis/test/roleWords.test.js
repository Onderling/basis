/**
 * @vitest-environment happy-dom
 *
 * The role words (Fable's three additions, 2026-10-05): the roles in the order a household thinks of them — member,
 * coordinator, observer — and the screen's role form makes you PICK one (no preselection: it preselected "coordinator",
 * which is how Frits' housemates became coordinators). Under the `flat` preset there are two words: `/role` takes
 * member or observer, and `/users` says "lid" for a member and a coordinator alike.
 */
import { describe, it, expect } from 'vitest';
import { BOT_ROLES } from '../src/v2/botSettings.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';
import { buildFormSpec } from '../src/forms/buildFormSpec.js';
import { renderForm } from '../src/web/domForm.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';

describe('the role words', () => {
  it('member, coordinator, observer — and the form asks for a pick, none preselected', () => {
    expect([...BOT_ROLES]).toEqual(['member', 'coordinator', 'observer']);
    const op = assistantManifest.operations.find((o) => o.id === 'assistant-role');
    const spec = buildFormSpec({ opParams: op.params, missing: ['who', 'role'], prefilledArgs: {}, opId: op.id, appOrigin: 'assistant' });
    const form = renderForm(spec, { doc: document, t: (k) => k, onSubmit: () => {} });
    const sel = form.querySelector('select[name="role"]');
    expect(sel.value).toBe('');
    expect(sel.required).toBe(true);
  });

  it('under flat: /role takes member or observer; /users says lid', async () => {
    const params = new Map([['assistant.roles', 'flat']]);
    const rows = [{ id: 'telegram:1', displayName: 'Frits', role: 'admin', channel: 'telegram' }, { id: 'telegram:7', displayName: 'Bert', role: 'coordinator', channel: 'telegram' }, { id: 'telegram:8', displayName: 'Cas', role: 'member', channel: 'telegram' }];
    const door = withAssistantOps({
      callSkill: async (app, op) => (app === 'params' && op === 'list-user-params' ? { ok: true, params: [...params].map(([key, value]) => ({ key, value })) } : { ok: true }),
      threads: { langOf: () => null }, t: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
      admin: { users: async () => rows, setRole: async (who, role) => ({ ...rows.find((r) => r.displayName === who || r.id === who), role }) },
    });
    const ctx = { caller: 'telegram:1', threadId: 'telegram:1', chatId: '1' };
    const refused = await door('assistant', 'assistant-role', { who: 'Cas', role: 'coordinator' }, ctx);
    expect(refused.ok).toBe(false);
    expect(refused.error.message).toBe('circle.bot.role_flat_two_words');
    expect((await door('assistant', 'assistant-role', { who: 'Cas', role: 'observer' }, ctx)).ok).toBe(true);
    const users = await door('assistant', 'assistant-users', {}, ctx);
    expect(users.message).toContain('Bert — circle.bot.role_word_lid');
    expect(users.message).toContain('Cas — circle.bot.role_word_lid');
    expect(users.message).toContain('Frits — admin');
  });
});
