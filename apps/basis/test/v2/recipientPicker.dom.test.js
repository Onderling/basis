// @vitest-environment happy-dom
//
// objective L · Phase 2 (web sharing UI) — the out-of-circle recipient picker. Two things are proven:
//   1. renderRecipientPicker is a thin DOM projection over the SHARED `pickableRecipients` selector: it lists
//      the contacts that carry a published network key and EXCLUDES those that don't; each row carries the
//      contact's network key on `data-network-key`.
//   2. Selecting a contact DISPATCHES shareItemToPublishedKey with the contact's pubKey as recipientNetworkKey.
//      The dispatch wiring reproduces circleApp's `openRecipientPicker` onPick closure VERBATIM over an injected
//      spy (circleApp can't be booted headless), so a regression in the arg mapping would fail here.
import { describe, it, expect, vi } from 'vitest';
import { renderRecipientPicker } from '../../web/v2/recipientPicker.js';
import { stoopContactToRow, peerToContactRow } from '../../src/v2/contactsSource.js';

const t = (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k);
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

// A stoop person WITH a key, a peer WITH a key, and a URL-only bot WITHOUT one (must be excluded).
const contacts = [
  stoopContactToRow({ webid: 'did:dave', displayName: 'Dave', pubKey: 'KEY_DAVE', trustLevel: 'vertrouwd' }),
  peerToContactRow({ pubKey: 'KEY_PEER', name: 'Peer One' }),
  peerToContactRow({ url: 'https://bot.example/agent', name: 'URL Bot' }),   // no key → excluded
];

describe('renderRecipientPicker — the out-of-circle recipient picker (web DOM)', () => {
  it('lists only contacts with a network key (thin DOM over pickableRecipients)', () => {
    const el = mount();
    renderRecipientPicker(el, { contacts, itemId: 'i1', t });
    const rows = el.querySelectorAll('.cc-recipient-picker__contact');
    expect(rows.length).toBe(2);   // the URL-only bot is excluded
    expect(rows[0].dataset.recipient).toBe('did:dave');
    expect(rows[0].dataset.networkKey).toBe('KEY_DAVE');
    expect(rows[1].dataset.networkKey).toBe('KEY_PEER');
    // The trust badge surfaces for a contact that carries a trustLevel.
    expect(el.querySelector('.cc-recipient-picker__trust')?.dataset.trust).toBe('vertrouwd');
    expect(el.textContent).not.toContain('URL Bot');
  });

  it('shows the empty state when no contact carries a network key', () => {
    const el = mount();
    renderRecipientPicker(el, { contacts: [peerToContactRow({ url: 'https://x/agent', name: 'X' })], t });
    expect(el.querySelector('.cc-recipient-picker__list')).toBeNull();
    expect(el.textContent).toContain('circle.share.no_contacts');
  });

  it('selecting a contact DISPATCHES shareItemToPublishedKey with the contact\'s pubKey as recipientNetworkKey', async () => {
    const el = mount();
    // The injected dispatch spy stands in for circleApp's shareItemToContact → shareItemToPublishedKey.
    const shareItemToPublishedKey = vi.fn(async () => ({ ok: true, ref: {} }));
    // circleApp's openRecipientPicker onPick closure, verbatim: recipient = row.id, recipientNetworkKey = row.recipientNetworkKey.
    const onPick = (r) => shareItemToPublishedKey({
      itemId: 'i1', fromCircleId: 'A', toCircleId: 'B',
      recipient: r.id, recipientNetworkKey: r.recipientNetworkKey,
    });
    renderRecipientPicker(el, { contacts, itemId: 'i1', t, onPick });

    // User clicks "Dave".
    el.querySelectorAll('.cc-recipient-picker__pick')[0].click();
    await Promise.resolve();

    expect(shareItemToPublishedKey).toHaveBeenCalledTimes(1);
    expect(shareItemToPublishedKey).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'i1', fromCircleId: 'A', toCircleId: 'B',
      recipient: 'did:dave', recipientNetworkKey: 'KEY_DAVE',   // ← the contact's published key
    }));
  });

  it('fires onCancel when the cancel button is clicked', () => {
    const el = mount();
    const onCancel = vi.fn();
    renderRecipientPicker(el, { contacts, t, onCancel });
    el.querySelector('.cc-recipient-picker__cancel').click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// D7 (grants-over-Peer) — the out-of-circle LINK warning, rendered before the pick.
describe('renderRecipientPicker — the out-of-circle link warning (D7)', () => {
  it('renders the warning above the list, resolved through t() (no hardcoded copy)', () => {
    const el = mount();
    renderRecipientPicker(el, { contacts, t, onPick: vi.fn() });
    const warn = el.querySelector('.cc-recipient-picker__link-warning');
    expect(warn).toBeTruthy();
    expect(warn.textContent).toBe('circle.share.link_warning');
    // It precedes the list — the person is told BEFORE choosing, not after.
    const list = el.querySelector('.cc-recipient-picker__list');
    expect(warn.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does NOT warn when there is nobody grantable (empty state — nothing to link to)', () => {
    const el = mount();
    renderRecipientPicker(el, { contacts: [peerToContactRow({ url: 'https://bot.example/a', name: 'Bot' })], t, onPick: vi.fn() });
    expect(el.querySelector('.cc-recipient-picker__link-warning')).toBeNull();
    expect(el.querySelector('.cc-recipient-picker__empty')).toBeTruthy();
  });

  it('is informational only: every grantable contact is still listed and pickable', () => {
    const el = mount();
    const onPick = vi.fn();
    renderRecipientPicker(el, { contacts, t, onPick });
    expect(el.querySelectorAll('.cc-recipient-picker__contact')).toHaveLength(2);   // unchanged by the warning
    el.querySelector('.cc-recipient-picker__pick').click();
    expect(onPick).toHaveBeenCalled();                                              // nothing is blocked
  });
});

