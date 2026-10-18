// @vitest-environment happy-dom
//
// objective L (web sharing UI) — the circle admin panel's OUTBOUND-share surface + the auto-revoke-on-removal
// wiring. Two things are proven here:
//   1. renderCircleAdminPanel renders the "Shared out of this circle" section and offers a per-row
//      "Stop sharing" button ONLY when the circle's posture is `canonical`; for non-canonical it shows the
//      `not_revocable` note (the share is a separate object, not a revocable in-place grant). onStopShare fires
//      with the right (itemId, toCircleId) share. This exercises the REAL panel renderer.
//   2. The showAdmin `onRemove` wiring: after a SUCCESSFUL removeMember, `revokeAllForMember` is invoked with
//      the threaded args, best-effort (a revoke failure NEVER blocks the removal). The revoke LOGIC itself is
//      covered in circleShareRevokeAll.test.js; this asserts the SHELL wiring/ordering contract that circleApp
//      cannot be booted headless to exercise in place (mirrors the showAdmin closure exactly).
import { describe, it, expect, vi } from 'vitest';
import { renderCircleAdminPanel } from '../../web/v2/circleAdminPanel.js';

const t = (k, p) => (p && 'count' in p ? `${k}:${p.count}` : (p ? `${k}:${JSON.stringify(p)}` : k));
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderCircleAdminPanel — outbound shares (Stop sharing)', () => {
  const shares = [
    { toCircleId: 'buren', itemId: 'item-1', sourceType: 'note' },
    { toCircleId: 'sport', itemId: 'item-2', sourceType: 'note' },
  ];

  it('shows the empty state when nothing is shared out', () => {
    const el = mount();
    renderCircleAdminPanel(el, { t, outboundShares: [], outboundCanonical: true });
    expect(el.querySelector('.cc-admin__share-list')).toBeNull();
    // the empty copy appears somewhere in the section
    expect(el.textContent).toContain('circle.share.outbound_empty');
  });

  it('renders one row per outbound share with a Stop-sharing button when canonical', () => {
    const el = mount();
    renderCircleAdminPanel(el, { t, outboundShares: shares, outboundCanonical: true });
    const rows = el.querySelectorAll('.cc-admin__share');
    expect(rows.length).toBe(2);
    expect(rows[0].dataset.itemId).toBe('item-1');
    expect(rows[0].dataset.circle).toBe('buren');
    // canonical ⇒ a Stop-sharing button, no not_revocable note
    expect(el.querySelectorAll('.cc-admin__share-stop').length).toBe(2);
    expect(el.querySelector('.cc-admin__share-note')).toBeNull();
  });

  it('does NOT offer Stop sharing for a non-canonical circle — shows the not_revocable note instead', () => {
    const el = mount();
    renderCircleAdminPanel(el, { t, outboundShares: shares, outboundCanonical: false });
    expect(el.querySelector('.cc-admin__share-stop')).toBeNull();
    const notes = el.querySelectorAll('.cc-admin__share-note');
    expect(notes.length).toBe(2);
    expect(notes[0].textContent).toBe('circle.share.not_revocable');
  });

  it('fires onStopShare with the exact share for the clicked row', () => {
    const el = mount();
    const onStopShare = vi.fn();
    renderCircleAdminPanel(el, { t, outboundShares: shares, outboundCanonical: true, onStopShare });
    el.querySelectorAll('.cc-admin__share-stop')[1].click();
    expect(onStopShare).toHaveBeenCalledTimes(1);
    expect(onStopShare).toHaveBeenCalledWith(shares[1]);
  });
});

// ── onRemove auto-revoke wiring ────────────────────────────────────────────────────────────────────────────
// Mirrors the showAdmin `onRemove` closure in circleApp.js (which is not independently bootable). The factory
// below reproduces that closure's control flow verbatim over injected deps, so a regression in the ORDER
// (revoke only after a successful remove) or the BEST-EFFORT guarantee (a revoke throw never blocks removal)
// would fail here. The args threaded to revokeAllForMember are asserted exactly.
function makeOnRemove({ id, members, circleIds, rawCallSkill, revokeAllForMember, recipientSealKeyFor,
  resolveService, enforcementFor, policyOf, setNotice }) {
  return async (m) => {
    let removed = false;
    try {
      const r = await rawCallSkill('pinboard', 'removeMember', { groupId: id, memberWebid: m.webid, memberStableId: m.stableId });
      if (r?.error) setNotice(t('circle.admin.refused'));
      else removed = true;
    } catch { setNotice(t('circle.admin.refused')); }
    if (removed && m.webid) {
      try {
        const remaining = (await Promise.all(
          members.filter((x) => x.webid && x.webid !== m.webid).map((x) => recipientSealKeyFor(id, x.webid)),
        )).filter(Boolean);
        const res = await revokeAllForMember({
          resolveService, enforcementFor, policyOf,
          fromCircleId: id, circleIds: circleIds.map((c) => c.id),
          recipient: m.webid, remainingRecipients: remaining.length ? remaining : undefined,
        });
        if (res.revoked > 0) setNotice(t('circle.share.member_revoked', { count: res.revoked }));
        if (res.failed.length > 0) setNotice(t('circle.share.member_revoke_failed', { count: res.failed.length }));
      } catch { /* best-effort */ }
    }
  };
}

describe('showAdmin onRemove — auto-revoke a departing member', () => {
  const id = 'family';
  const circles = [{ id: 'family' }, { id: 'buren' }, { id: 'sport' }];
  const members = [
    { webid: 'https://alice.example/#me', stableId: 'a' },
    { webid: 'https://bob.example/#me', stableId: 'b' },
    { webid: 'https://carol.example/#me', stableId: 'c' },
  ];
  const deps = () => ({
    id, members, circleIds: circles,
    resolveService: 'RS', enforcementFor: 'EF', policyOf: 'PO',
    recipientSealKeyFor: vi.fn(async (_c, w) => `key:${w}`),
    setNotice: vi.fn(),
  });

  it('calls revokeAllForMember with the threaded args AFTER a successful removeMember', async () => {
    const d = deps();
    const order = [];
    const rawCallSkill = vi.fn(async () => { order.push('remove'); return { ok: true }; });
    const revokeAllForMember = vi.fn(async () => { order.push('revoke'); return { ok: true, attempted: 2, revoked: 2, skipped: 0, failed: [] }; });
    const onRemove = makeOnRemove({ ...d, rawCallSkill, revokeAllForMember });

    await onRemove(members[0]); // remove Alice

    // ordering: remove first, then revoke
    expect(order).toEqual(['remove', 'revoke']);
    expect(revokeAllForMember).toHaveBeenCalledTimes(1);
    const args = revokeAllForMember.mock.calls[0][0];
    expect(args.fromCircleId).toBe('family');
    expect(args.recipient).toBe(members[0].webid);
    expect(args.circleIds).toEqual(['family', 'buren', 'sport']);
    expect(args.resolveService).toBe('RS');
    expect(args.enforcementFor).toBe('EF');
    expect(args.policyOf).toBe('PO');
    // remaining recipients = the OTHER two members' resolved origin-circle sealing keys
    expect(args.remainingRecipients).toEqual(['key:https://bob.example/#me', 'key:https://carol.example/#me']);
    // success ⇒ member_revoked notice with the revoked count
    expect(d.setNotice).toHaveBeenCalledWith('circle.share.member_revoked:2');
  });

  it('does NOT revoke when removeMember was refused', async () => {
    const d = deps();
    const rawCallSkill = vi.fn(async () => ({ error: 'not-admin' }));
    const revokeAllForMember = vi.fn();
    const onRemove = makeOnRemove({ ...d, rawCallSkill, revokeAllForMember });
    await onRemove(members[0]);
    expect(revokeAllForMember).not.toHaveBeenCalled();
    expect(d.setNotice).toHaveBeenCalledWith('circle.admin.refused');
  });

  it('is best-effort — a revoke throw NEVER blocks the removal', async () => {
    const d = deps();
    const rawCallSkill = vi.fn(async () => ({ ok: true }));
    const revokeAllForMember = vi.fn(async () => { throw new Error('boom'); });
    const onRemove = makeOnRemove({ ...d, rawCallSkill, revokeAllForMember });
    await expect(onRemove(members[0])).resolves.toBeUndefined(); // did not throw
  });

  it('surfaces the failure count when some revokes failed (removal still succeeded)', async () => {
    const d = deps();
    const rawCallSkill = vi.fn(async () => ({ ok: true }));
    const revokeAllForMember = vi.fn(async () => ({ ok: false, attempted: 3, revoked: 1, skipped: 0, failed: [{ error: 'x' }, { error: 'y' }] }));
    const onRemove = makeOnRemove({ ...d, rawCallSkill, revokeAllForMember });
    await onRemove(members[0]);
    expect(d.setNotice).toHaveBeenCalledWith('circle.share.member_revoke_failed:2');
  });
});
