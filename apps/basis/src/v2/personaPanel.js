/**
 * THE PERSONA PANEL — what the persona button (top right on every tab) opens, over the tab that is showing, on both
 * shells the same: a short view of who I am and how I show myself (the name with "Aanpassen", "Deel mijn kaart", my
 * devices and helpers: the manifest's `meActions` and `meBlocks`, filled by `mijScreenBlocks`).
 *
 * With more than one persona on the device the panel has one tab per persona, the general self first; the tab picks
 * whose name and devices the short view shows (the materializer's `mijSelf`). The "Laat zien als" switcher (which
 * personas the app shows: `screen-set-personas`, `switcherModel`) is kept as a door from the panel, so its function is
 * not lost: a tab says whose panel this is, the switcher says what the app shows. With one persona: no tabs, no door.
 */

/**
 * @param {object} a
 * @param {Array<{id: string, name?: string|null}>} a.held   this device's selves (`personasHere`)
 * @param {string|null} [a.selected]   the tab the person picked; one no longer held falls back to the general self
 * @returns {{ tabs: Array<{id: string, name: string|null, nameKey?: string, active: boolean}>, selected: string,
 *   mijSelf: {id: string, name: string|null}|null, showAs: boolean }}
 */
export function personaPanelModel({ held = [], selected = null } = {}) {
  const selves = (Array.isArray(held) ? held : []).filter((p) => p && typeof p.id === 'string' && p.id);
  const general = selves.find((p) => p.id === 'default');
  const ordered = general ? [general, ...selves.filter((p) => p !== general)] : selves;
  const sel = ordered.some((p) => p.id === selected) ? selected : (ordered[0]?.id ?? 'default');
  const many = ordered.length > 1;
  const tabs = many
    ? ordered.map((p) => ({ id: p.id, name: p.id === 'default' ? null : (p.name ?? p.id), ...(p.id === 'default' ? { nameKey: 'circle.switcher.you' } : {}), active: p.id === sel }))
    : [];
  const picked = ordered.find((p) => p.id === sel);
  return {
    tabs,
    selected: sel,
    mijSelf: sel !== 'default' && picked ? { id: picked.id, name: picked.name ?? null } : null,
    showAs: many,
  };
}
