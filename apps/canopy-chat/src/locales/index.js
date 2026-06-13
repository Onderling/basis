// Shared locale blocks — the SINGLE source for keys both the web and mobile shells render, so they
// can't drift (the `circle.*` v2 surface used to be copy-pasted into both `locales/{en,nl}.json`, and
// drifted — `circle.bot.*` existed on mobile but not web → `/me` showed the raw key `circle.bot.failed`).
//
// Each shell merges these over its own platform-only keys: `{ ...appLocale, circle: sharedCircleLocale.<lng> }`.
// Leaves are the `{ text, doc }` shape (each shell's loader unwraps them). Add more shared blocks here
// (chat/common/reply/…) the same way as they get consolidated.

import circleEn from './circle.en.json';
import circleNl from './circle.nl.json';

/** The canonical `circle` block per language (union of the former web + mobile copies; 0 value conflicts). */
export const sharedCircleLocale = { en: circleEn, nl: circleNl };
