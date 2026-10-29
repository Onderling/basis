/**
 * What an editable field shows after its data (re)loads: the loaded value, unless the person has typed in it since the
 * last load painted it — then what they typed. A form that paints at once and again when its data arrives must not
 * wipe a name typed in between (Save would then see no change and send nothing). Both shells' editors use this.
 * @param {{current?: string|null, drawn?: string|null, loaded?: string|null}} a
 *   current: what the field holds now · drawn: what the last load put there · loaded: what has just loaded
 * @returns {string}
 */
export function fieldAfterLoad({ current = null, drawn = null, loaded = null } = {}) {
  const typed = typeof current === 'string' && current !== (drawn ?? '');
  return typed ? current : (loaded ?? '');
}
