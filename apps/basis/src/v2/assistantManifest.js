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
    'set-memory': 'write', 'set-reminders': 'write', 'set-overview': 'write', 'set-language': 'write', 'set-apps': 'write', 'set-settings': 'write', 'set-role': 'write', status: 'read', 'list-users': 'read',
    'open-cohort': 'write', invite: 'write', rotate: 'write', 'revoke-user': 'write',
  },
  operations: [
    {
      id:     'assistant-memory',
      verb:   'set-memory',
      // The thread row lives on the door's own device.
      writes: { scope: 'device' },
      params: [{ name: 'mode', kind: 'enum', of: [...MEMORY_MODES], required: true }],
      surfaces: {
        slash: { command: '/geheugen', body: 'argline' },
        chat:  { reply: 'text', hint: 'How much of this conversation the assistant keeps: off (nothing), short (the last few turns), long.' },
      },
    },    {
      id:     'assistant-reminders',
      verb:   'set-reminders',
      // a person's own switch for the reminders the bot writes first (only things they dated); on the thread row
      writes: { scope: 'device' },
      params: [{ name: 'mode', kind: 'enum', of: ['on', 'off'], required: true }],
      surfaces: {
        slash: { command: '/herinneringen', body: 'argline' },
        chat:  { reply: 'text', hint: 'Reminders on or off for this person (mode = on or off).' },
      },
    },
    {
      id:     'assistant-overview',
      verb:   'set-overview',
      // a person's own switch for the weekly overview (off until they switch it on); on the thread row
      writes: { scope: 'device' },
      params: [{ name: 'mode', kind: 'enum', of: ['on', 'off'], required: true }],
      surfaces: {
        slash: { command: '/overzicht', body: 'argline' },
        chat:  { reply: 'text', hint: 'The weekly overview on or off for this person (mode = on or off).' },
      },
    },

    {
      id:     'assistant-language',
      verb:   'set-language',
      writes: { scope: 'device' },
      params: [{ name: 'lang', kind: 'enum', of: [...THREAD_LANGS, 'auto'], required: true }],
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
      verb:   'set-settings',
      visibility: 'trusted',
      // The bot's own settings are parameters of the door's device (who may give a chore to whom).
      writes: { scope: 'device' },
      // `assign self|anyone|role` · `roles admin,member` · nothing (the settings as they stand)
      params: [{ name: 'change', kind: 'string', required: false }],
      surfaces: { slash: { command: '/instellingen', body: 'argline' } },
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
  ],
};
