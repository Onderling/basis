/**
 * circleMyData — the S5 "My data" screen. @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleMyData } from '../web/v2/circleMyData.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

describe('renderCircleMyData', () => {
  it('shows the pod-local status + relay when not signed in', () => {
    const el = renderCircleMyData(document.createElement('div'), {
      t, podStatus: { signedIn: false },
      dataLocation: { relayOperator: 'Onderling', relayUrl: 'wss://relay.example' },
    });
    const kvs = [...el.querySelectorAll('.cc-mydata__kv')].map((r) => r.querySelector('.cc-mydata__v').textContent);
    expect(kvs).toContain('circle.mydata.pod_local');
    expect(kvs.some((v) => v.includes('Onderling') && v.includes('wss://relay.example'))).toBe(true);
  });

  it('shows a sign-in button when local-only + wires it to onSignIn', () => {
    const onSignIn = vi.fn();
    const el = renderCircleMyData(document.createElement('div'), { t, podStatus: { signedIn: false }, onSignIn });
    const btn = el.querySelector('.cc-mydata__signin');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('circle.mydata.pod_sign_in');
    btn.click();
    expect(onSignIn).toHaveBeenCalled();
  });

  it('no sign-in button once signed in', () => {
    const el = renderCircleMyData(document.createElement('div'), {
      t, podStatus: { signedIn: true, webid: 'https://me.pod/profile' }, onSignIn: () => {},
    });
    expect(el.querySelector('.cc-mydata__signin')).toBeNull();
  });

  it('shows pod root + signed-in status when on a pod', () => {
    const el = renderCircleMyData(document.createElement('div'), {
      t, podStatus: { signedIn: true, webid: 'https://me.pod/profile' },
      dataLocation: { podRoot: 'https://me.pod/' },
    });
    const text = el.textContent;
    expect(text).toContain('circle.mydata.pod_signed_in');
    expect(text).toContain('https://me.pod/');
  });

  it('lists privacy sections + usage metrics', () => {
    const el = renderCircleMyData(document.createElement('div'), {
      t,
      privacy: [{ title: 'Encryption', body: 'Messages are sealed before they leave the device.' }],
      metrics: { posts: 4, claims: 1 },
    });
    expect(el.querySelector('.cc-mydata__privacy-title').textContent).toBe('Encryption');
    expect(el.querySelector('.cc-mydata__privacy-body').textContent).toContain('sealed');
    const usage = [...el.querySelectorAll('.cc-mydata__kv')].map((r) => r.textContent).join('|');
    expect(usage).toContain('posts');
    expect(usage).toContain('4');
  });

  it('renders the key-management actions only when their callbacks are wired', () => {
    const bare = renderCircleMyData(document.createElement('div'), { t, podStatus: { signedIn: true } });
    expect(bare.querySelector('.cc-mydata__action')).toBeNull();

    const onBackup = vi.fn(); const onViewMnemonic = vi.fn(); const onRestore = vi.fn();
    const el = renderCircleMyData(document.createElement('div'), {
      t, podStatus: { signedIn: true }, onBackup, onViewMnemonic, onRestore,
    });
    el.querySelector('.cc-mydata__backup').click();
    el.querySelector('.cc-mydata__mnemonic').click();
    el.querySelector('.cc-mydata__restore').click();
    expect(onBackup).toHaveBeenCalled();
    expect(onViewMnemonic).toHaveBeenCalled();
    expect(onRestore).toHaveBeenCalled();
  });

  it('add-a-device: the enroll action renders when wired and fires its callback', () => {
    const onEnroll = vi.fn();
    const el = renderCircleMyData(document.createElement('div'), {
      t, podStatus: { signedIn: true }, onEnroll,
    });
    el.querySelector('.cc-mydata__enroll').click();
    expect(onEnroll).toHaveBeenCalled();
  });

  it('devices: live rows get a revoke door, tombstones render struck without one', () => {
    const onRevokeDevice = vi.fn();
    const el = renderCircleMyData(document.createElement('div'), {
      t, podStatus: { signedIn: true }, onRevokeDevice,
      devices: [
        { deviceId: 'dev-1', label: 'telefoon', revoked: false },
        { deviceId: 'dev-2', label: 'verloren', revoked: true },
      ],
    });
    const rows = el.querySelectorAll('.cc-mydata__device');
    expect(rows.length).toBe(2);
    const buttons = el.querySelectorAll('.cc-mydata__device-revoke');
    expect(buttons.length).toBe(1);                      // only the live row
    buttons[0].click();
    expect(onRevokeDevice).toHaveBeenCalledWith('dev-1');
  });

  it('the history-mirror row: state line reflects off/on/error; the toggle fires the flip', () => {
    const onToggleHistoryMirror = vi.fn();
    const off = renderCircleMyData(document.createElement('div'), {
      t, historyMirror: { enabled: false, status: null }, onToggleHistoryMirror,
    });
    expect(off.querySelector('[data-role="history-status"]').textContent).toBe('circle.mydata.history_off');
    const btn = off.querySelector('.cc-mydata__history-toggle');
    expect(btn.textContent).toBe('circle.mydata.history_enable');
    btn.click();
    expect(onToggleHistoryMirror).toHaveBeenCalled();

    const on = renderCircleMyData(document.createElement('div'), {
      t, historyMirror: { enabled: true, status: { mirrored: 12, pending: 2, lastError: null } }, onToggleHistoryMirror,
    });
    expect(on.querySelector('[data-role="history-status"]').textContent).toContain('circle.mydata.history_on');
    expect(on.querySelector('[data-role="history-status"]').textContent).toContain('14');   // mirrored + pending
    expect(on.querySelector('.cc-mydata__history-toggle').textContent).toBe('circle.mydata.history_disable');

    const err = renderCircleMyData(document.createElement('div'), {
      t, historyMirror: { enabled: true, status: { mirrored: 3, lastError: 'pod weg' } }, onToggleHistoryMirror,
    });
    expect(err.querySelector('[data-role="history-status"]').textContent).toContain('circle.mydata.history_error');

    // absent prop → no section (unchanged surface for hosts that don't pass it)
    const none = renderCircleMyData(document.createElement('div'), { t });
    expect(none.querySelector('[data-role="history-status"]')).toBe(null);
  });

  it('renders the push-notification toggle reflecting subscription state', () => {
    const onToggleNotifications = vi.fn();
    const off = renderCircleMyData(document.createElement('div'), {
      t, notifications: { supported: true, subscribed: false }, onToggleNotifications,
    });
    const enable = off.querySelector('.cc-mydata__notif-toggle');
    expect(enable.textContent).toBe('circle.mydata.notif_enable');
    enable.click();
    expect(onToggleNotifications).toHaveBeenCalled();

    const on = renderCircleMyData(document.createElement('div'), {
      t, notifications: { supported: true, subscribed: true }, onToggleNotifications,
    });
    expect(on.querySelector('.cc-mydata__notif-toggle').textContent).toBe('circle.mydata.notif_disable');

    // unsupported: status shown, no toggle button
    const no = renderCircleMyData(document.createElement('div'), {
      t, notifications: { supported: false }, onToggleNotifications,
    });
    expect(no.querySelector('.cc-mydata__notif-toggle')).toBeNull();
    expect(no.textContent).toContain('circle.mydata.notif_unsupported');
  });

  it('omits the notifications section when no toggle handler is wired', () => {
    const el = renderCircleMyData(document.createElement('div'), { t, notifications: { supported: true } });
    expect(el.querySelector('.cc-mydata__notif-status')).toBeNull();
  });

  it('S6.C — renders the surface-preference selector with the active option marked + a tap sets it', () => {
    const onSetSurfacePref = vi.fn();
    const el = renderCircleMyData(document.createElement('div'), {
      t, surfacePref: 'screen', onSetSurfacePref,
    });
    const prefs = [...el.querySelectorAll('.cc-mydata__pref')].map((b) => b.dataset.pref);
    expect(prefs).toEqual(['inline', 'screen', 'chat']);
    expect(el.querySelector('.cc-mydata__pref.is-active').dataset.pref).toBe('screen');
    el.querySelector('[data-pref="chat"]').click();
    expect(onSetSurfacePref).toHaveBeenCalledWith('chat');
  });

  it('S6.D — under "chat", shows whether AI is enriching the conversation', () => {
    const onChat = renderCircleMyData(document.createElement('div'), {
      t, surfacePref: 'chat', onSetSurfacePref: () => {}, chatAi: { enriched: true, reason: 'on' },
    });
    expect(onChat.querySelector('.cc-mydata__chat-ai').textContent).toContain('circle.mydata.chat_ai_on');

    const offCircle = renderCircleMyData(document.createElement('div'), {
      t, surfacePref: 'chat', onSetSurfacePref: () => {}, chatAi: { enriched: false, reason: 'circle-off' },
    });
    expect(offCircle.querySelector('.cc-mydata__chat-ai').textContent).toContain('circle.mydata.chat_ai_circle_off');

    // not shown when chat isn't the selected projection
    const onInline = renderCircleMyData(document.createElement('div'), {
      t, surfacePref: 'inline', onSetSurfacePref: () => {}, chatAi: { enriched: true, reason: 'on' },
    });
    expect(onInline.querySelector('.cc-mydata__chat-ai')).toBeNull();
  });

  it('omits the surface-preference selector when no setter is wired', () => {
    const el = renderCircleMyData(document.createElement('div'), { t, surfacePref: 'inline' });
    expect(el.querySelector('.cc-mydata__pref')).toBeNull();
  });

  it('fires onBack', () => {
    const onBack = vi.fn();
    const el = renderCircleMyData(document.createElement('div'), { t, onBack });
    el.querySelector('.cc-mydata__back').click();
    expect(onBack).toHaveBeenCalled();
  });

  it('my agents: a row per owned node; giving access asks the node, picks who, ticks what, and says how it ended', async () => {
    const opened = []; const granted = [];
    const el = renderCircleMyData(document.createElement('div'), {
      t, companions: [{ node: 'N'.repeat(43), short: 'NNNNNNNN…' }],
      onOpenCompanionGrant: async (node) => { opened.push(node); return { ok: true, targets: [{ key: 'B'.repeat(43), label: 'Huishoudbot' }], choices: [{ id: 'agenda-files', label: 'agenda-bestanden plaatsen' }] }; },
      onGrantCompanion: async (args) => { granted.push(args); return 'gegeven'; },
    });
    expect(el.querySelector('.cc-mydata__companion-name').textContent).toContain('NNNNNNNN');
    el.querySelector('.cc-mydata__companion-give').click();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(opened).toEqual(['N'.repeat(43)]);
    expect([...el.querySelectorAll('.cc-mydata__companion-to option')].map((o) => o.textContent)).toEqual(['Huishoudbot']);
    // nothing ticked: nothing granted
    el.querySelector('.cc-mydata__companion-confirm').click();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(granted).toEqual([]);
    el.querySelector('.cc-mydata__companion-family').checked = true;
    el.querySelector('.cc-mydata__companion-confirm').click();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(granted).toEqual([{ node: 'N'.repeat(43), to: 'B'.repeat(43), families: ['agenda-files'] }]);
    expect(el.querySelector('.cc-mydata__companion-note').textContent).toBe('gegeven');
  });

  it('my agents: a node that cannot be asked says why; no one to grant to says how to add the bot', async () => {
    const el = renderCircleMyData(document.createElement('div'), {
      t, companions: [{ node: 'N'.repeat(43), short: 'a' }, { node: 'M'.repeat(43), short: 'b' }],
      onOpenCompanionGrant: async (node) => (node.startsWith('N') ? { ok: false, message: 'antwoordt niet' } : { ok: true, targets: [], choices: [] }),
      onGrantCompanion: async () => '',
    });
    const [a, b] = el.querySelectorAll('.cc-mydata__companion-give');
    a.click(); b.click();
    await new Promise((r) => { setTimeout(r, 0); });
    const notes = [...el.querySelectorAll('.cc-mydata__companion-note')].map((n) => n.textContent);
    expect(notes).toEqual(['antwoordt niet', 'circle.companionGrant.to_none']);
    expect(renderCircleMyData(document.createElement('div'), { t }).querySelector('.cc-mydata__companion')).toBeNull();
  });
});
