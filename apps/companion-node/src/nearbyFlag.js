/**
 * `--nearby` — the CLI half of the companion's local radio.
 *
 * The node has taken part in a nearby room since 2026-08-30, but only when something called
 * `startCompanionNode({ nearby: … })` in code. Every walk of it therefore went through a scratch script,
 * and on 2026-08-31 the person who wrote that script forgot it existed. A capability reachable only by
 * writing a program is one nobody remembers you have.
 *
 * Parsing lives here rather than in `boot.js` so it can be tested without a radio, a socket, or a node.
 *
 * ── The grammar, and why publishing is spelled out ──────────────────────────────────────────────────
 *   --nearby                 browse only: see the room, announce nothing
 *   --nearby=publish         announce as well, indefinitely
 *   --nearby=publish:30m     announce, bounded — expires back to browse (s/m/h suffixes; bare = minutes)
 *   --nearby-label=<name>    the mDNS hostname other devices see (default: the node's own label)
 *
 * Browse is the default because `startNearbyMdns` says why: *"a companion that announces itself
 * permanently is a presence beacon with a stable identifier, so publishing is an explicit act."* The
 * flag keeps that shape instead of softening it — you cannot publish by accident, and `publish:30m` is
 * one keystroke more than `publish`.
 *
 * `COMPANION_NEARBY` takes the same values, so the env-var convention the rest of `boot.js` uses still
 * works; an explicit flag wins over the env var.
 */

/** `30m` → ms. Bare numbers are minutes, which is the unit a person testing a radio actually thinks in. */
export function parseDuration(text) {
  const m = /^(\d+)(s|m|h)?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * ({ s: 1000, m: 60_000, h: 3_600_000 }[m[2] ?? 'm']);
}

/**
 * Turn argv + env into the `nearby` option `startCompanionNode` takes.
 *
 * @param {string[]} [argv]  process.argv.slice(2)
 * @param {Record<string,string|undefined>} [env]
 * @returns {{nearby: false|{mdns:true, publish?:boolean, publishFor?:number, label?:string},
 *            error?: string}}
 *   `nearby:false` means the plugin is never imported — the module documents that as the OFF path.
 *   `error` is a sentence for the user; the caller decides whether to exit.
 */
export function parseNearbyFlag(argv = [], env = {}) {
  let raw = null;
  let label = null;
  for (const arg of argv) {
    if (arg === '--nearby') raw = raw ?? '';
    else if (arg.startsWith('--nearby=')) raw = arg.slice('--nearby='.length);
    else if (arg.startsWith('--nearby-label=')) label = arg.slice('--nearby-label='.length) || null;
  }
  if (raw === null && env.COMPANION_NEARBY !== undefined) raw = env.COMPANION_NEARBY;
  if (raw === null) return { nearby: false };

  const value = String(raw).trim().toLowerCase();
  // `--nearby` with nothing after it, and the env var set to an on-ish word, both mean "browse".
  if (value === '' || value === 'true' || value === '1' || value === 'browse') {
    return { nearby: { mdns: true, ...(label ? { label } : {}) } };
  }
  if (value === 'false' || value === '0' || value === 'off') return { nearby: false };

  const [head, tail] = value.split(':');
  if (head !== 'publish') {
    return { nearby: false, error: `--nearby: expected "browse", "publish" or "publish:<duration>", got "${raw}"` };
  }
  if (tail === undefined) return { nearby: { mdns: true, publish: true, ...(label ? { label } : {}) } };

  const publishFor = parseDuration(tail);
  if (publishFor === null) {
    return { nearby: false, error: `--nearby: "${tail}" is not a duration — try 90s, 30m or 2h` };
  }
  return { nearby: { mdns: true, publish: true, publishFor, ...(label ? { label } : {}) } };
}
