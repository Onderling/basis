/**
 * A role change whose parent is a statement of ANOTHER kind on the same lane (an address revocation, a
 * person-key announcement) still comes after everything that parent came after. Depth used to be taken
 * over the membership statements only, so such a parent counted as missing, the role change sat at
 * depth 0 — before the promotion it was meant to undo — and the promotion won.
 */
import { describe, it, expect } from 'vitest';
import { foldRoster } from '../src/security/rosterFold.js';

const st = (hash, kind, author, subject, parentHash = null, payload = undefined) =>
  ({ hash, kind, author, subject, parentHash, deps: [], ...(payload ? { payload } : {}) });

describe('the fold orders through statements of other kinds', () => {
  it('a demotion signed after an address revocation undoes the earlier promotion', () => {
    const chain = [
      st('h1', 'join', 'ada', 'cleo'),
      st('h2', 'role', 'ada', 'cleo', 'h1', { role: 'admin' }),
      st('h3', 'person-key', 'ada', 'ada', 'h2'),
      st('h4', 'address-revoke', 'ada', 'ada', 'h3'),
      st('h5', 'role', 'ada', 'cleo', 'h4', { role: 'member' }),
    ];
    const r = foldRoster(chain, { founders: ['ada'] });
    expect(r.members).toContain('cleo');
    expect(r.admins, 'the later demotion holds').not.toContain('cleo');
  });
});
