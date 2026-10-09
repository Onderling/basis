/**
 * hostFrame — the site a HOSTED web build belongs to, so the page can link back to it.
 *
 * A build put online by a site (the org's own, or anyone's) shows one line at the top: a link back to that site.
 * Which site is a DEPLOYMENT fact, never a fact of the code: it rides two build values beside the relay and the
 * seeded card (`VITE_HOST_RETURN_TO`, `VITE_HOST_RETURN_LABEL` on web), and a build without them — anyone's own —
 * shows no line at all. Mobile has no host and no frame.
 *
 * Pure — no DOM, no env read; the shell hands in its values.
 */

/**
 * The frame from the build values, or null when there is none. Only an absolute http(s) link counts: anything else
 * (empty, relative, another scheme) is no frame, quietly — an install without one is not an error state.
 *
 * @param {{ returnTo?: string|null, label?: string|null }} [values]
 * @returns {{ href: string, label: string } | null}  `label` falls back to the link's host
 */
export function hostFrameOf({ returnTo, label } = {}) {
  const raw = typeof returnTo === 'string' ? returnTo.trim() : '';
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const name = typeof label === 'string' && label.trim() ? label.trim() : url.host;
  return { href: url.href, label: name };
}
