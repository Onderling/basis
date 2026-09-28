/**
 * assistant — the ops a door's assistant offers about the person's OWN conversation with it.
 *
 * A door that is not a circle (the box's Telegram chat) keeps each person's thread (`botThreads.js`). These ops set
 * that thread's memory mode and language. They are the person's own settings for their own thread, so they have a
 * chat and a slash surface: "vergeet dit gesprek" or `/geheugen uit` is how a person turns memory off. They reach no
 * other setting: the bot's app list and the admin's default memory mode are parameters, set by the admin, never
 * from a sentence.
 *
 * Handled by the door's composition (`withAssistantOps`), which knows the thread the call is for.
 */
import { MEMORY_MODES, THREAD_LANGS } from './botThreads.js';

/** @type {import('@onderling/app-manifest').__types__} */
export const assistantManifest = {
  app:       'assistant',
  // Nothing it does reaches the network.
  hosts:     [],
  itemTypes: ['chat-thread'],
  domainVerbs: { 'set-memory': 'write', 'set-language': 'write' },
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
  ],
};
