/**
 * assistant — the ops a door's assistant offers about the person's OWN conversation with it.
 *
 * A door that is not a circle (the box's Telegram chat) keeps each person's thread (`botThreads.js`). These ops set
 * that thread's memory mode and language. They are the person's own settings for their own thread, so they have a
 * chat and a slash surface: "vergeet dit gesprek" or `/geheugen uit` is how a person turns memory off. They reach no
 * other setting: the bot's app list and the admin's default memory mode are parameters, set by the admin, never
 * from a sentence.
 *
 * The ADMIN's ops — the bot's app list, its status, who it serves — are `visibility: 'trusted'` (the host gate's level
 * for the bot's admin) and have a slash surface only: the model is never offered them, so no sentence switches an app.
 *
 * Handled by the door's composition (`withAssistantOps`), which knows the thread the call is for and asks the host
 * gate about the caller's level.
 */
import { MEMORY_MODES, THREAD_LANGS } from './botThreads.js';

/** @type {import('@onderling/app-manifest').__types__} */
export const assistantManifest = {
  app:       'assistant',
  // Nothing it does reaches the network.
  hosts:     [],
  itemTypes: ['chat-thread'],
  domainVerbs: {
    'set-memory': 'write', 'week-overview': 'read', 'set-reminders': 'write', 'set-overview': 'write', 'set-language': 'write', 'set-apps': 'write', 'set-settings': 'write', 'set-role': 'write', status: 'read', 'list-users': 'read',
    'open-cohort': 'write', invite: 'write', rotate: 'write', 'revoke-user': 'write', 'list-exports': 'read', 'export-household': 'write', 'import-household': 'write',
    'connect-screen': 'write', 'manage-screens': 'write', 'show-settings': 'read', 'set-view': 'write', 'confirm-screen': 'write', 'paste-screen': 'write',
  },
  operations: [
    {
      id:     'assistant-memory',
      // a setting: `/instellingen` paints a row for it (the menu is derived from this group)
      group:  'settings',
      verb:   'set-memory',
      // The thread row lives on the door's own device.
      writes: { scope: 'device' },
      params: [{ name: 'mode', kind: 'enum', of: [...MEMORY_MODES], required: false }],
      surfaces: {
        slash: { command: '/geheugen', body: 'argline' },
        chat:  { reply: 'text', hint: 'How much of this conversation the assistant keeps: off (nothing), short (the last few turns), long.' },
      },
    },    {
      id:     'weekOverview',
      verb:   'week-overview',
      // a person's week, asked as that person (the gate, the role and the names ceiling apply): their open chores, the
      // coming appointments, how many open on the shopping list, how many chores nobody holds
      params: [],
      surfaces: {
        slash: { command: '/week', body: 'none' },
        chat:  { reply: 'text', hint: "This member's week: their own chores, the appointments, what is open on the shopping list." },
      },
    },
    {
      id:     'assistant-reminders',
      // a setting: `/instellingen` paints a row for it (the menu is derived from this group)
      group:  'settings',
      verb:   'set-reminders',
      // a person's own switch for the reminders the bot writes first (only things they dated); on the thread row
      writes: { scope: 'device' },
      params: [{ name: 'mode', kind: 'enum', of: ['on', 'off'], required: false }],
      surfaces: {
        slash: { command: '/herinneringen', body: 'argline' },
        chat:  { reply: 'text', hint: 'Reminders on or off for this person (mode = on or off).' },
      },
    },
    {
      id:     'assistant-overview',
      // a setting: `/instellingen` paints a row for it (the menu is derived from this group)
      group:  'settings',
      verb:   'set-overview',
      // a person's own switch for the weekly overview (off until they switch it on); on the thread row
      writes: { scope: 'device' },
      params: [{ name: 'mode', kind: 'enum', of: ['on', 'off'], required: false }],
      surfaces: {
        slash: { command: '/overzicht', body: 'argline' },
        chat:  { reply: 'text', hint: 'The weekly overview on or off for this person (mode = on or off).' },
      },
    },

    {
      id:     'assistant-language',
      // a setting: `/instellingen` paints a row for it (the menu is derived from this group)
      group:  'settings',
      verb:   'set-language',
      writes: { scope: 'device' },
      params: [{ name: 'lang', kind: 'enum', of: [...THREAD_LANGS, 'auto'], required: false }],
      surfaces: {
        slash: { command: '/taal', body: 'argline' },
        chat:  { reply: 'text', hint: 'The language the assistant replies in for this person; auto follows how they write.' },
      },
    },
    {
      id:     'assistant-apps',
      verb:   'set-apps',
      visibility: 'trusted',
      // The app list is a parameter of the door's own device.
      writes: { scope: 'device' },
      // `on <app>` · `off <app>` · nothing (the list as it stands)
      params: [{ name: 'change', kind: 'string', required: false }],
      surfaces: { slash: { command: '/apps', body: 'argline' } },
    },
    {
      id:     'assistant-settings',
      // a setting: `/instellingen` paints a row for it (the menu is derived from this group)
      group:  'settings',
      verb:   'set-settings',
      visibility: 'trusted',
      // The bot's own settings are parameters of the door's device (who may give a chore to whom).
      writes: { scope: 'device' },
      // `assign self|anyone|role` · `roles admin,member` · nothing (the settings as they stand)
      params: [{ name: 'change', kind: 'string', required: false }],
      // Two changes ask first on a screen (they take something from everyone at once); the rest are shown at once
      // and undone the same way. The confirm is the surface's: it guards a slip, the waist decides as the admin.
      surfaces: { slash: { command: '/huishouden', body: 'argline' }, ui: { confirm: { severity: 'warn', when: ['names none', 'reminders off'], messageKey: 'circle.bot.settings_confirm', message: 'This changes it for everyone. Sure?' } } },
    },
    {
      id:     'assistant-role',
      verb:   'set-role',
      visibility: 'trusted',
      // A person's role on the bot is on their contact row (the bot's people), the same words as a circle's roster.
      writes: { scope: 'device' },
      // `<naam> coordinator|member|observer`
      params: [{ name: 'spec', kind: 'string', required: true }],
      surfaces: { slash: { command: '/role', body: 'argline' } },
    },
    {
      id:     'assistant-status',
      verb:   'status',
      visibility: 'trusted',
      params: [],
      surfaces: { slash: { command: '/status', body: 'none' } },
    },
    {
      id:     'assistant-users',
      verb:   'list-users',
      visibility: 'trusted',
      params: [],
      surfaces: { slash: { command: '/users', body: 'none' } },
    },
    // ── Admission: who may start talking to the bot (a code the admin hands out). ──
    {
      id:     'assistant-cohort',
      verb:   'open-cohort',
      visibility: 'trusted',
      writes: { scope: 'device' },
      // `<people> <days>` — a new cohort; the one before stops admitting
      params: [{ name: 'spec', kind: 'string', required: false }],
      surfaces: { slash: { command: '/cohort', body: 'argline' } },
    },
    {
      id:     'assistant-invite',
      verb:   'invite',
      visibility: 'trusted',
      // a code is minted, not stored — but the cohort's state is this device's
      writes: { scope: 'device' },
      params: [],
      surfaces: { slash: { command: '/invite', body: 'none' } },
    },
    {
      id:     'assistant-rotate',
      verb:   'rotate',
      visibility: 'trusted',
      writes: { scope: 'device' },
      params: [],
      surfaces: { slash: { command: '/rotate', body: 'none' } },
    },
    {
      id:     'assistant-revoke',
      verb:   'revoke-user',
      visibility: 'trusted',
      // the person's contact row is hidden, which the book carries to the person's other devices
      writes: { scope: 'person' },
      params: [{ name: 'who', kind: 'string', required: true }],
      surfaces: { slash: { command: '/revoke', body: 'argline' } },
    },
    {
      // The person's settings menu: one row per settings op their role reaches (their own switches; for the admin the
      // household's too), each with its current value and buttons that call that op through its own gate.
      id:     'assistant-menu',
      verb:   'show-settings',
      visibility: 'authenticated',
      params: [],
      surfaces: { slash: { command: '/instellingen', body: 'none' } },
    },
    {
      // How this person's menus are painted: buttons in the chat (inline), on their connected screen, or in words.
      id:     'assistant-view',
      verb:   'set-view',
      visibility: 'authenticated',
      group:  'settings',
      writes: { scope: 'device' },
      params: [{ name: 'mode', kind: 'string', required: true }],
      surfaces: { slash: { command: '/weergave', body: 'argline' } },
    },
    {
      // A person connects a screen (their own app, in a browser) to act through: a one-time link, ten minutes, for
      // them alone. Whoever holds the link in that time can connect a screen as them — one use, the notice in their
      // chat and `/schermen` are the mitigation. Slash only: the model never hands out a link.
      id:     'assistant-screen',
      verb:   'connect-screen',
      visibility: 'authenticated',
      writes: { scope: 'device' },
      // the admin's default is the paste route (no secret in the chat); `/scherm link` asks for the one-time link
      params: [{ name: 'how', kind: 'string', required: false }],
      surfaces: { slash: { command: '/scherm', body: 'argline' } },
    },
    {
      // A screen's own connect code, pasted by the person into their own chat. Nothing is granted on the paste: the
      // same question follows (the code to pick from three).
      id:     'assistant-screen-paste',
      verb:   'paste-screen',
      visibility: 'authenticated',
      writes: { scope: 'device' },
      params: [{ name: 'offer', kind: 'string', required: true }],
      surfaces: { slash: { command: '/koppel-scherm', body: 'argline' } },
    },
    {
      // The person's answer to "a screen wants to connect as you — code 4F7K, is that the one you see?": counted only
      // from their PRIVATE door (never a group). The buttons of that question send it; it can be typed too.
      id:     'assistant-screen-confirm',
      verb:   'confirm-screen',
      visibility: 'authenticated',
      writes: { scope: 'device' },
      params: [{ name: 'answer', kind: 'string', required: true }],
      surfaces: { slash: { command: '/koppelen', body: 'argline' } },
    },
    {
      // The person's own screens, and dropping one (`/schermen los 2`).
      id:     'assistant-screens',
      verb:   'manage-screens',
      visibility: 'authenticated',
      writes: { scope: 'device' },
      params: [{ name: 'change', kind: 'string', required: false }],
      surfaces: { slash: { command: '/schermen', body: 'argline' } },
    },
    {
      id:     'assistant-exports',
      verb:   'list-exports',
      visibility: 'trusted',
      // the household's export files on the box (one a night, the last few kept)
      params: [],
      // slash only, like the admin's other ops: never a tool the model is handed
      surfaces: { slash: { command: '/exports', body: 'none' } },
    },
    {
      id:     'assistant-export',
      verb:   'export-household',
      visibility: 'trusted',
      // one export now, onto the box's shelf (before an upgrade: export, upgrade, import) — sealed when a key is set
      writes: { scope: 'device' },
      params: [],
      surfaces: { slash: { command: '/export', body: 'none' } },
    },
    {
      id:     'assistant-import',
      verb:   'import-household',
      visibility: 'trusted',
      // the household's lists, chores, appointments and people, written back through their own ops
      writes: { scope: 'circle' },
      params: [{ name: 'file', kind: 'string', required: true }],
      surfaces: {
        slash: { command: '/import', body: 'argline' },
        // asked first, with what the file holds (the op answers the question with `preview: true`)
        ui:    { confirm: { severity: 'danger', messageKey: 'circle.bot.import_confirm', message: 'Read this export back into the household?', preview: true } },
      },
    },
  ],
};
