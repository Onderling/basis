/**
 * `calendar-event` type — a time-bounded event. Cross-app
 * (Tasks's lend-due reminders, Stoop's group events, Folio's
 * future calendar notes).
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';
import { ITEM_REMINDERS_SCHEMA } from '../reminderRules.js';

export const CALENDAR_EVENT_SCHEMA = {
  iri:         `${NAMESPACE}CalendarEvent`,
  description: 'A time-bounded event. startsAt + endsAt + optional location + attendees.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'title', 'startsAt'],
  properties: {
    ...BASE_PROPERTIES,
    type:      { const: 'calendar-event' },
    title:     { type: 'string', minLength: 1 },
    body:      { type: 'string' },
    startsAt:  { type: 'string', format: 'date-time' },
    endsAt:    { type: 'string', format: 'date-time' },
    location:  { type: 'string' },
    attendees: { type: 'array', items: { type: 'string' } },
    // the household's reminders for this item (`morning` · `evening-before` · `before:<min>` · `at:<HH:MM>`)
    reminders: ITEM_REMINDERS_SCHEMA,
    organiser: { type: 'string' },
  },
};
