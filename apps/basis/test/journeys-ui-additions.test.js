// @vitest-environment happy-dom
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VERIFICATION-JOURNEY HARNESS — the UI added over the Jul 12–26 fortnight.
 *
 * A lot of surface shipped in two weeks (governance panel · §8 reporting ·
 * reveal-level picker · continue-as-existing-self · member-card pictures ·
 * out-of-circle link warning · theme toggle in settings · the create wizard on
 * the launcher) and almost none of it had a USER-LEVEL check — only unit tests
 * of the parts. This file is that acceptance net: each journey drives the REAL
 * renderer the app mounts and asserts what a person would actually see.
 *
 * Deliberately journeys, not unit tests: the units are already covered
 * elsewhere. What these catch is a surface being unreachable, unstyled, or
 * silently defaulted — the class of bug that produced the wizard-stylesheet and
 * the create-wizard findings on 2026-07-26, both of which unit tests missed
 * because every part worked in isolation.
 *
 * GREEN now : the web renderers (happy-dom can mount them).
 * TODO      : RN screens — vitest does not render them (see vitest.config.js),
 *             so those carry their on-device steps verbatim and are tracked in
 *             REMAINING-WORK's "UI/UX verification queue".
 *
 * SCOPE: test-only; edits no source. `t()` is a passthrough that returns the
 * key, so every assertion below doubles as a check that the string went through
 * the locale layer (invariant #8) rather than being baked into the markup.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import { renderJoinGroupWizard } from '../src/web/wizards/joinGroupWizard.js';
import { renderCreateGroupWizard } from '../src/web/wizards/createGroupWizard.js';
import { renderRecipientPicker } from '../web/v2/recipientPicker.js';
import { renderCircleSettings } from '../web/v2/circleSettings.js';
import { renderGovernancePanel } from '../web/v2/circleGovernancePanel.js';
import { renderMemberPersonaCard } from '../web/v2/circleMemberCard.js';
import { peerToContactRow } from '../src/v2/contactsSource.js';
import { memberPersonaView } from '../src/v2/memberCards.js';

const t = (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k);
const mount = () => { const el = document.createElement('div'); document.body.appendChild(el); return el; };
const buttonByLabel = (root, label) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label) ?? null;
const clickByLabel = (root, label) => {
  const b = buttonByLabel(root, label);
  if (!b) throw new Error(`no button: ${label}`);
  b.click();
};

// ── J-UI-1 — Starting a circle gives you the CHOICES, not a silent default ────────────────────────────
//
// The launcher's "+ new circle" used to raise a native prompt() and create the circle immediately, so the
// governance / rules / offerings choices were never asked and silently defaulted (fixed 2026-07-26). This
// journey pins that the create surface is the WIZARD and that it actually presents those steps.
describe('J-UI-1 — creating a circle walks the wizard, not a one-line prompt', () => {
  it('opens on a real step rail with a name field, and never calls prompt()', () => {
    const promptSpy = vi.spyOn(globalThis, 'prompt').mockReturnValue('x');
    const el = mount();
    renderCreateGroupWizard({ container: el, doc: document, callSkill: vi.fn(async () => ({ ok: true })), onClose: vi.fn(), onDispatched: vi.fn(), t });

    expect(el.querySelector('.cc-wizard-steps')).toBeTruthy();          // a multi-step rail exists…
    expect(el.querySelectorAll('.cc-wizard-step').length).toBeGreaterThan(1);
    expect(el.querySelector('.cc-wizard-input, .cc-wizard-field')).toBeTruthy();   // …with real fields
    expect(promptSpy).not.toHaveBeenCalled();                            // the bare path is gone
    promptSpy.mockRestore();
  });

  it('every wizard control carries a cc-wizard-* class, so the ported stylesheet reaches it', () => {
    const el = mount();
    renderCreateGroupWizard({ container: el, doc: document, callSkill: vi.fn(async () => ({ ok: true })), onClose: vi.fn(), onDispatched: vi.fn(), t });
    // The 2026-07-26 finding was that these classes existed but were styled in an UNLOADED sheet. The
    // fitness guard checks the CSS side; this checks the markup side still emits them.
    const classed = [...el.querySelectorAll('[class]')].filter((n) => /cc-wizard-/.test(n.className));
    expect(classed.length).toBeGreaterThan(3);
  });
});

// ── J-UI-2 — Joining: what you reveal is CHOSEN, and the link is disclosed ────────────────────────────
describe('J-UI-2 — a joiner sees and controls what they reveal', () => {
  const invite = { kind: 'membershipCode', groupId: 'b1', code: 'c1' };
  const openWizard = () => {
    const el = mount();
    renderJoinGroupWizard({ container: el, doc: document, args: { invite }, callSkill: vi.fn(async () => ({ ok: true })), onClose: vi.fn(), onDispatched: vi.fn() });
    // rules → privacy → handle
    const accept = el.querySelector('.cc-wizard-check input[type=checkbox]');
    accept.checked = true; accept.dispatchEvent(new Event('change'));
    clickByLabel(el, 'circle.join.wizard.next');
    const privacy = el.querySelector('.cc-wizard-check input[type=checkbox]');
    privacy.checked = true; privacy.dispatchEvent(new Event('change'));
    clickByLabel(el, 'circle.join.wizard.next');
    return el;
  };

  it('the reveal LEVEL is a visible choice on the handle step (not applied silently)', () => {
    const el = openWizard();
    const sel = el.querySelector('.cc-wizard-reveal-select');
    expect(sel).toBeTruthy();
    expect([...sel.options].map((o) => o.value)).toEqual(['handle', 'profile', 'full']);
    // The label came through t() — no baked copy.
    expect(el.textContent).toContain('circle.join.wizard.reveal.label');
  });

  it('the joiner can lower it to handle-only, and the wizard keeps that choice', () => {
    const el = openWizard();
    const sel = el.querySelector('.cc-wizard-reveal-select');
    sel.value = 'handle';
    sel.dispatchEvent(new Event('change'));
    expect(el.querySelector('.cc-wizard-reveal-select').value).toBe('handle');
  });
});

// ── J-UI-3 — Sharing out of the circle tells you it creates a visible link ────────────────────────────
describe('J-UI-3 — the out-of-circle recipient picker warns before the pick', () => {
  const contacts = [peerToContactRow({ pubKey: 'KEY_A', name: 'Ada' })];

  it('shows the link warning ABOVE the list, through t()', () => {
    const el = mount();
    renderRecipientPicker(el, { contacts, t, onPick: vi.fn() });
    const warn = el.querySelector('.cc-recipient-picker__link-warning');
    expect(warn?.textContent).toBe('circle.share.link_warning');
    const list = el.querySelector('.cc-recipient-picker__list');
    expect(warn.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is informational — the recipient is still pickable (never a gate)', () => {
    const el = mount();
    const onPick = vi.fn();
    renderRecipientPicker(el, { contacts, t, onPick });
    el.querySelector('.cc-recipient-picker__pick').click();
    expect(onPick).toHaveBeenCalled();
  });
});

// ── J-UI-4 — Governance is legible: a vote, its tally, and admin-only controls ────────────────────────
describe('J-UI-4 — the governance panel shows the decision and gates admin controls', () => {
  const view = {
    open: [{
      proposalId: 'p1', action: 'removeMember', subjectLabel: 'Bram',
      status: 'pending', tally: { yes: 1, no: 0, need: 3, of: 4 }, canVote: true, deadline: 100,
    }],
    closed: [],
  };

  it('a member sees the open decision + tally, but NOT the decision-class settings', () => {
    const el = mount();
    renderGovernancePanel(el, { view, t, isAdmin: false, onVote: vi.fn() });
    expect(el.textContent).toContain('Bram');                       // the subject resolves to a NAME
    expect(el.querySelector('.circle-governance__settings')).toBeNull();
  });

  it('an admin additionally gets the decision-class settings block', () => {
    const el = mount();
    renderGovernancePanel(el, { view, t, isAdmin: true, policy: { governance: { removeMember: 'member-vote' } }, onVote: vi.fn(), onSetClass: vi.fn() });
    expect(el.querySelector('.circle-governance__settings')).toBeTruthy();
  });

  it('§8 reports: an admin sees the reports section, a member does not', () => {
    const reports = [{ reportId: 'r1', kind: 'message', subjectLabel: 'Cato', reason: 'spam', status: 'open' }];
    const admin = mount();
    renderGovernancePanel(admin, { view: { open: [], closed: [] }, t, isAdmin: true, reports, onDismissReport: vi.fn(), onActReport: vi.fn() });
    expect(admin.querySelector('.circle-governance__reports')).toBeTruthy();

    const member = mount();
    renderGovernancePanel(member, { view: { open: [], closed: [] }, t, isAdmin: false, reports });
    expect(member.querySelector('.circle-governance__reports')).toBeNull();
  });
});

// ── J-UI-5 — A member card shows only what the viewer may see ─────────────────────────────────────────
describe('J-UI-5 — the member-persona card respects the disclosure split', () => {
  it('a revealed real name lands in "sees"; an unrevealed one in "hides"', () => {
    const revealed = { id: 'bram', handle: 'fox', realName: 'Bram', reveals: ['me'] };
    const hidden   = { id: 'cato', handle: 'heron', realName: 'Cato', reveals: [] };

    const a = mount();
    renderMemberPersonaCard(a, { member: revealed, split: memberPersonaView({ member: revealed, viewerWebid: 'me' }), t });
    expect(a.querySelector('[data-attr="realName"]')).toBeTruthy();
    expect(a.textContent).toContain('Bram');

    const b = mount();
    renderMemberPersonaCard(b, { member: hidden, split: memberPersonaView({ member: hidden, viewerWebid: 'me' }), t });
    expect(b.textContent).not.toContain('Cato');            // never leaked into the markup at all
  });

  const PIC = { type: 'blob', ref: 'blob://x', enc: { sealed: true, mime: 'image/jpeg' } };
  const withPic = { id: 'bram', handle: 'fox', realName: 'Bram', reveals: ['me'], profilePicture: PIC };

  it('renders as an IMAGE (never a stringified ref) once the viewer is entitled', () => {
    // `open` policy entitles every member, so this exercises the RENDER path itself.
    const split = memberPersonaView({ member: withPic, viewerWebid: 'me', policy: 'open' });
    expect(split.sees.map((a) => a.key)).toContain('profilePicture');

    const el = mount();
    renderMemberPersonaCard(el, { member: withPic, split, t, resolvePicture: () => 'data:image/jpeg;base64,AAA' });
    const row = el.querySelector('[data-attr="profilePicture"]');
    expect(row).toBeTruthy();
    expect(row.querySelector('img')).toBeTruthy();
    expect(row.textContent).not.toContain('blob://');     // the sealed ref must never be shown as text
  });

  // ✅ FIXED 2026-07-26 (Frits's call). A pairwise reveal is ONE act — "I show this person who I am" —
  // not a per-attribute list, so it covers the picture the member put on their row too (a picture is only
  // ever there because they shared it). Layer (a), the member's own disclosure, still decides whether the
  // attribute exists at all, so nothing the member did not share is widened.
  it('a viewer the member revealed to now sees the picture under the DEFAULT pairwise policy', () => {
    const split = memberPersonaView({ member: withPic, viewerWebid: 'me', policy: 'pairwise' });
    expect(split.sees.map((a) => a.key)).toContain('profilePicture');
    // …and it still must never leak to a viewer with NO reveal at all.
    const stranger = memberPersonaView({ member: { ...withPic, reveals: [] }, viewerWebid: 'nobody', policy: 'pairwise' });
    expect(stranger.sees.map((a) => a.key)).not.toContain('profilePicture');
  });
});

// ── J-UI-6 — Settings: the display theme is findable and marked per-device ────────────────────────────
describe('J-UI-6 — the theme toggle is reachable from settings', () => {
  it('renders the three choices with the active one marked, and says it is per-device', () => {
    const el = mount();
    renderCircleSettings(el, {
      policy: {}, t, onChange: vi.fn(), onSave: vi.fn(),
      themePref: 'dark', onSetTheme: vi.fn(),
    });
    const btns = [...el.querySelectorAll('.cc-mydata__theme-btn')];
    expect(btns.map((b) => b.dataset.theme)).toEqual(['system', 'light', 'dark']);
    expect(btns.find((b) => b.dataset.theme === 'dark').getAttribute('aria-pressed')).toBe('true');
    expect(el.textContent).toContain('circle.settings.theme_hint');
  });

  it('picking a theme calls the handler (and nothing is saved through the policy Save)', () => {
    const onSetTheme = vi.fn(); const onSave = vi.fn();
    const el = mount();
    renderCircleSettings(el, { policy: {}, t, onChange: vi.fn(), onSave, themePref: 'system', onSetTheme });
    el.querySelector('.cc-mydata__theme-btn[data-theme="light"]').click();
    expect(onSetTheme).toHaveBeenCalledWith('light');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('omitting the handler omits the block entirely (no dead control)', () => {
    const el = mount();
    renderCircleSettings(el, { policy: {}, t, onChange: vi.fn(), onSave: vi.fn() });
    expect(el.querySelector('.cc-mydata__theme-btn')).toBeNull();
  });
});

// ── RN journeys — vitest cannot render React Native screens (vitest.config.js) ────────────────────────
// These carry their on-device steps verbatim; they are the mobile half of the queue in REMAINING-WORK.
describe('J-UI-M — mobile surfaces (device-only)', () => {
  it.todo('"+ new circle" opens the 5-step CreateGroupWizardModal (not an inline name row); review → the circle lands with the chosen governance/rules/offerings [2026-07-26]');
  it.todo('join wizard: the reveal-level RadioGroup shows handle/profile/full and the chosen level survives the join [§1.6]');
  it.todo('member card: a shared profile picture renders as an <Image> (testID membercard-attr-profilePicture-img), not stringified ref text');
  it.todo('Mij: tap the photo row → pick an image → it seals, previews, and persists across a reopen');
  it.todo('governance panel: member sees tally without settings; admin sees decision-class settings + Reports');
  it.todo('§8: report a member / post / message → all three land in the admin Reports section');
  it.todo('out-of-circle share: the link warning shows above the recipient list before the pick');
});
