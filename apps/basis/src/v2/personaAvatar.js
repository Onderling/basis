/**
 * The header avatar (top-right on every tab): the active persona's picture — the `profilePicture` attribute, a sealed
 * ref each shell opens with its own opener — or, without one, its initials. One loader both shells call; with one
 * persona the avatar is the person's, and a tap opens their own editor.
 */

/** The first letters of up to two words of a name, upper case; '?' for none. */
export function initialsOf(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

/** The picture ref on a profile's properties: an attribute as stored (`{value}`) or bare; null for none. */
export function pictureRefOf(properties) {
  const entry = properties?.profilePicture;
  if (entry && typeof entry === 'object' && entry.value !== undefined) return entry.value ?? null;
  return entry ?? null;
}

/**
 * @param {object} a
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill   the shell's targeted call
 * @param {string} [a.profileId='default']
 * @param {string|null} [a.name]   a persona's own name (its registry entry); the default's is the person's profile name
 * @returns {Promise<{name: string|null, initials: string, picture: any}>}
 */
export async function loadPersonaAvatar({ callSkill, profileId = 'default', name: given = null } = {}) {
  let name = profileId === 'default' ? null : given;
  let picture = null;
  if (profileId === 'default') {
    try { const p = await callSkill('stoop', 'getMyProfile', {}); name = p?.entry?.displayName || p?.entry?.handle || null; } catch { /* nameless */ }
  }
  try { picture = pictureRefOf((await callSkill('agents', 'getProfileProperties', { id: profileId }))?.properties); } catch { /* no picture */ }
  return { name, initials: initialsOf(name), picture };
}
