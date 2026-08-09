/**
 * Folio.B1.tray — real persistent menubar / system-tray icon.
 *
 * v2.7 replaces the toast-only B1.tray (notify-send / osascript shell-out)
 * with a persistent, clickable icon that lives in the user's menubar.  The
 * library is `systray2` (Go-binary worker, prebuilt, no node-gyp); see
 * `apps/folio/src/tray/CHOICE.md` for the full rationale + binary hashes.
 *
 * Public surface:
 *
 *   const handle = await startTray({
 *     statusUrl:        'http://127.0.0.1:8888/status',
 *     openUrl:          'http://127.0.0.1:8888',
 *     localRoot:        '/home/me/notes',
 *     pollIntervalMs:   5000,
 *     backoffIntervalMs: 30000,
 *     backoffThreshold: 5,
 *     // — injection points (tests) ——————————————————————————————————————
 *     platform:    process.platform,            // OS dispatch override
 *     loadSystray: async () => SysTrayClass,    // mock for tests
 *     loadDriver:  async (path) => createDriver,// legacy (mock-mode tests)
 *     fetch:       globalThis.fetch,
 *     openUrlImpl: (url, opts) => Promise<void>,
 *     openFolderImpl: (path, opts) => Promise<void>,
 *   });
 *
 *   handle.stop();                 // tear down (kills the helper process)
 *   handle._diagnostics.state      // current icon state
 *   handle._diagnostics.menu       // last-broadcast menu shape (for tests)
 *
 * Behaviour spec (v2.7 task):
 *   - Persistent icon in menubar/tray.
 *   - States: idle (green) / active (blue) / conflict (yellow) / error (red).
 *   - Header item: "Folio — synced X minutes ago" (or "Folio — error").
 *   - Action items:
 *       * Open notes folder       → opens `localRoot` in OS file manager
 *       * Open Folio              → opens `openUrl` in default browser
 *       * Sync now                → POST /sync/now
 *       * Pause sync / Resume sync → POST /watch/stop or /watch/start
 *       * Recent conflicts (N)    → submenu of up to 5; click → /#conflicts
 *       * Quit Folio              → POST /shutdown (X-Folio-Shutdown header)
 *   - Polls /status every `pollIntervalMs`; backs off to `backoffIntervalMs`
 *     after `backoffThreshold` consecutive failures.
 *   - Click handlers MUST never throw — every handler swallows + logs.
 *
 * The four backward-compat helpers (`statusToState`, `driverNameFor`,
 * `openUrl`, `STATES`) are kept so the legacy test surface continues to
 * pass; the per-OS shim modules under `./linux.js` etc are now thin
 * fallback stubs (mock-mode only — see those files).
 */
import { platform }       from 'node:os';
import { exec }           from 'node:child_process';
import { fileURLToPath }  from 'node:url';
import { dirname, join }  from 'node:path';
import { readFileSync }   from 'node:fs';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

// ─── Public constants ──────────────────────────────────────────────────────

export const STATES = Object.freeze({
  idle:     'sync-idle',
  active:   'sync-active',
  conflict: 'sync-conflict',
  error:    'sync-error',
});

// Parameter register (#36) — tray /status poll cadence + failure backoff (scope:device, kind:internal).
const POLL_INTERVAL_MS    = param({ key: 'folio.trayPollIntervalMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5_000 });
const BACKOFF_INTERVAL_MS = param({ key: 'folio.backoffIntervalMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000 });
const BACKOFF_THRESHOLD   = param({ key: 'folio.backoffThreshold', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5 });

const HERE      = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(HERE, 'icons');

/** Special menu-item ids — used by the click router. */
const ITEM_IDS = Object.freeze({
  HEADER:        'header',
  OPEN_FOLDER:   'open-folder',
  OPEN_FOLIO:    'open-folio',
  SYNC_NOW:      'sync-now',
  PAUSE_RESUME:  'pause-resume',
  CONFLICTS:     'conflicts',
  QUIT:          'quit',
});

// ─── statusToState (kept for backwards compat; used internally) ────────────

/**
 * Map a `/status` payload to one of the four icon states.
 *
 * Inputs are best-effort — different server versions may return slightly
 * different shapes.  We accept either:
 *   { state: 'idle' | 'active' | 'conflict' | 'error' }
 *   { syncing: boolean, conflicts: number, errors: number }
 *
 * Newer Folio /status shape (2026-04+) carries:
 *   { stats, watching, lastSyncAt, pending: { conflicts, ... }, lastError }
 * We treat presence of `lastError` as 'error', `pending.conflicts > 0` as
 * 'conflict', `watching && stats.uploads/downloads > 0` as 'active'.
 *
 * @param {object} status
 * @returns {'idle'|'active'|'conflict'|'error'}
 */
export function statusToState(status) {
  if (!status || typeof status !== 'object') return 'error';

  if (typeof status.state === 'string' && Object.keys(STATES).includes(status.state)) {
    return status.state;
  }

  // Newer Folio /status shape.
  const conflicts = (status.pending?.conflicts ?? status.conflicts ?? 0) | 0;
  const errors    = status.lastError != null
    ? 1
    : ((status.errors ?? 0) | 0);

  if (errors    > 0) return 'error';
  if (conflicts > 0) return 'conflict';

  if (status.syncing === true)        return 'active';
  // No active-sync flag in the new shape; treat "watching but actively syncing"
  // as active when stats indicate in-flight work.  Otherwise idle.
  if (status.watching && status.stats?.inFlight) return 'active';
  return 'idle';
}

// ─── driverNameFor (kept for backwards compat) ─────────────────────────────

/**
 * Choose a fallback driver module name for the given OS.  Used only when
 * `loadDriver` is supplied (mock-mode tests).  Real-mode startTray uses
 * systray2 directly — no per-OS driver dispatch.
 *
 * @param {string} osName
 * @returns {string}
 */
export function driverNameFor(osName) {
  switch (osName) {
    case 'darwin': return './macos.js';
    case 'linux':  return './linux.js';
    case 'win32':  return './windows.js';
    default:       return './linux.js';
  }
}

// ─── openUrl (kept for backwards compat + used by click handlers) ──────────

/**
 * Open a URL in the user's default browser via the OS shell.
 * Uses native commands so we don't add a dep.
 *
 * @param {string} url
 * @param {{ platform?: string, exec?: Function }} [deps]
 * @returns {Promise<void>}
 */
export async function openUrl(url, { platform: osName = platform(), exec: execImpl } = {}) {
  const run = execImpl ?? exec;
  let cmd, args;
  if (osName === 'darwin') {
    cmd = 'open'; args = [url];
  } else if (osName === 'win32') {
    cmd = 'cmd';  args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open'; args = [url];
  }
  return new Promise((res, rej) => {
    run(`${cmd} ${args.map((a) => JSON.stringify(a)).join(' ')}`, (err) => {
      if (err) rej(err); else res();
    });
  });
}

/**
 * Open a local folder in the OS file manager.  Same backend as openUrl
 * (open / xdg-open / explorer); kept separate so callers can intent-tag.
 *
 * @param {string} folderPath
 * @param {{ platform?: string, exec?: Function }} [deps]
 * @returns {Promise<void>}
 */
export async function openFolder(folderPath, { platform: osName = platform(), exec: execImpl } = {}) {
  const run = execImpl ?? exec;
  let cmd;
  if (osName === 'darwin')      cmd = `open ${JSON.stringify(folderPath)}`;
  else if (osName === 'win32')  cmd = `explorer ${JSON.stringify(folderPath)}`;
  else                          cmd = `xdg-open ${JSON.stringify(folderPath)}`;
  return new Promise((res, rej) => {
    run(cmd, (err) => {
      if (err) rej(err); else res();
    });
  });
}

// ─── Header text helper ────────────────────────────────────────────────────

/**
 * Build the menu header line.
 *
 *   - error                                      → "Folio — error"
 *   - lastSyncAt missing                         → "Folio — never synced"
 *   - synced just now (<60 s)                    → "Folio — synced just now"
 *   - synced n minutes ago                       → "Folio — synced 7 minutes ago"
 *   - synced n hours ago                         → "Folio — synced 3 hours ago"
 *
 * @param {string} state
 * @param {number|null} lastSyncAt  epoch-ms
 * @param {number} [now]            override for tests
 */
export function headerText(state, lastSyncAt, now = Date.now()) {
  if (state === 'error') return 'Folio — error';
  if (lastSyncAt == null || !Number.isFinite(lastSyncAt)) return 'Folio — never synced';
  const ageMs = Math.max(0, now - lastSyncAt);
  if (ageMs < 60_000)              return 'Folio — synced just now';
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60)                return `Folio — synced ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)                  return `Folio — synced ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Folio — synced ${days} day${days === 1 ? '' : 's'} ago`;
}

// ─── Menu builder ──────────────────────────────────────────────────────────

/**
 * Build the systray2 Menu shape from the current observed state.
 *
 * @param {object} args
 * @param {string} args.state                     - 'idle' | 'active' | 'conflict' | 'error'
 * @param {number|null} args.lastSyncAt           - ms epoch or null
 * @param {boolean} args.watching                 - paused if false
 * @param {Array<{relPath: string}>} args.conflicts - up to 5 surfaced
 * @param {string} args.iconBase64                - icon for the tray (base64 png)
 * @param {number} [args.now]                     - override clock for tests
 */
export function buildMenu({ state, lastSyncAt, watching, conflicts = [], iconBase64, now }) {
  const conflictItems = conflicts.slice(0, 5).map((c, i) => ({
    title:   c.relPath ?? `conflict-${i}`,
    tooltip: 'Open in Folio',
    enabled: true,
    __folioId: `conflict-${i}`,
  }));

  return {
    icon:    iconBase64 ?? '',
    title:   'Folio',
    tooltip: 'Folio — markdown ↔ Solid pod',
    isTemplateIcon: false,
    items: [
      {
        title:   headerText(state, lastSyncAt, now),
        tooltip: 'Folio status',
        enabled: false,
        __folioId: ITEM_IDS.HEADER,
      },
      {
        title:   'Open notes folder',
        tooltip: 'Reveal the local folder in your file manager',
        enabled: true,
        __folioId: ITEM_IDS.OPEN_FOLDER,
      },
      {
        title:   'Open Folio',
        tooltip: 'Open Folio in your browser',
        enabled: true,
        __folioId: ITEM_IDS.OPEN_FOLIO,
      },
      separator(),
      {
        title:   'Sync now',
        tooltip: 'Run a one-shot sync',
        enabled: true,
        __folioId: ITEM_IDS.SYNC_NOW,
      },
      {
        title:   watching ? 'Pause sync' : 'Resume sync',
        tooltip: watching ? 'Stop the file watcher' : 'Start the file watcher',
        enabled: true,
        __folioId: ITEM_IDS.PAUSE_RESUME,
      },
      separator(),
      {
        title:   `Recent conflicts (${conflicts.length})`,
        tooltip: 'List recent conflicts',
        enabled: conflicts.length > 0,
        __folioId: ITEM_IDS.CONFLICTS,
        items:   conflictItems.length > 0 ? conflictItems : undefined,
      },
      separator(),
      {
        title:   'Quit Folio',
        tooltip: 'Stop the Folio agent and quit the tray',
        enabled: true,
        __folioId: ITEM_IDS.QUIT,
      },
    ],
  };
}

function separator() {
  return { title: '<SEPARATOR>', tooltip: '', enabled: true };
}

// ─── Icon-loading helpers (for systray2 menu icons) ────────────────────────

/**
 * One-time synchronous pre-load of all four icon PNGs at module import
 * time.  Sync so fake-timers in tests can't deadlock the poll loop on a
 * pending fs read.  ~1 KB per icon × 4 → trivial memory cost.
 *
 * On read failure we cache an empty string (the systray2 binary tolerates
 * an empty icon — it just renders the previous one).  An override hook
 * (`loadIconBase64({ readFile })`) is kept for tests that want to inject
 * fakes.
 */
const ICON_CACHE = (() => {
  const out = {};
  for (const state of Object.values(STATES)) {
    try {
      const buf = readFileSync(join(ICONS_DIR, `${state}.png`));
      out[state] = Buffer.from(buf).toString('base64');
    } catch {
      out[state] = '';
    }
  }
  return out;
})();

/**
 * Resolve the base64-encoded PNG for the given icon state.  Synchronous
 * and side-effect-free; uses the module-level cache.
 *
 * Kept async to preserve the historical signature.
 *
 * @param {string} state - one of STATES values (the long-form, e.g. 'sync-idle')
 * @param {{ readFile?: Function, iconsDir?: string }} [deps]
 */
export async function loadIconBase64(state, deps = {}) {
  if (deps.readFile || deps.iconsDir) {
    // Test override: use the injected reader.  Async to match historical sig.
    const file = join(deps.iconsDir ?? ICONS_DIR, `${state}.png`);
    try {
      const reader = deps.readFile ?? readFileSync;
      const buf = await reader(file);
      return Buffer.from(buf).toString('base64');
    } catch {
      return '';
    }
  }
  return ICON_CACHE[state] ?? '';
}

// ─── startTray — main entry point ──────────────────────────────────────────

/**
 * Start the tray (real or mock — see opts.loadSystray / opts.loadDriver).
 *
 * @param {object} opts
 * @returns {Promise<{ stop: () => Promise<void>, _diagnostics: object }>}
 */
export async function startTray(opts = {}) {
  const statusUrl       = opts.statusUrl       ?? 'http://127.0.0.1:8888/status';
  const baseUrl         = opts.openUrl         ?? deriveBaseUrl(statusUrl);
  const localRoot       = opts.localRoot       ?? null;
  const pollMs          = opts.pollIntervalMs  ?? POLL_INTERVAL_MS;
  const backoffMs       = opts.backoffIntervalMs ?? BACKOFF_INTERVAL_MS;
  const backoffAfter    = opts.backoffThreshold ?? BACKOFF_THRESHOLD;
  const osName          = opts.platform        ?? platform();
  const fetchImpl       = opts.fetch           ?? globalThis.fetch;
  const openUrlImpl     = opts.openUrlImpl     ?? ((url) => openUrl(url, { platform: osName }));
  const openFolderImpl  = opts.openFolderImpl  ?? ((p) => openFolder(p, { platform: osName }));
  const onShutdown      = opts.onShutdown      ?? null;
  const log             = opts.log             ?? ((msg) => process.stderr.write(`folio tray: ${msg}\n`));

  // ── Mock-mode (legacy tests) ─────────────────────────────────────────────
  // If `loadDriver` is supplied we run in the legacy driver harness instead
  // of booting systray2.  This keeps the old tray.test.js patterns alive.
  if (opts.loadDriver) {
    return runInDriverMode({
      statusUrl, baseUrl, pollMs, backoffMs, backoffAfter, osName, fetchImpl,
      openUrlImpl, opts,
    });
  }

  // ── Real mode (or systray2-mock via opts.loadSystray) ────────────────────
  const SysTrayClass = await loadSystrayClass(opts.loadSystray);

  // Initial menu shape (idle, never-synced, watching=true).
  const iconBase64 = await loadIconBase64('idle', {});
  let lastMenu = buildMenu({
    state: 'idle',
    lastSyncAt: null,
    watching: true,
    conflicts: [],
    iconBase64,
  });

  const sysTray = new SysTrayClass({
    menu:  lastMenu,
    debug: false,
  });

  let stopped          = false;
  let consecutiveFails = 0;
  let timer            = null;
  let currentState     = 'idle';
  let currentStatus    = null;     // last good /status payload
  let currentWatching  = true;
  let currentSyncedAt  = null;
  let currentConflicts = [];

  // Wait for systray2's helper process to come up.  Errors are surfaced via
  // the log hook + we still resolve the promise so the caller can decide
  // whether to fall back (e.g. headless CI).
  try {
    if (typeof sysTray.ready === 'function') await sysTray.ready();
  } catch (err) {
    log(`tray ready failed: ${err?.message ?? err}`);
  }

  // Click router.  Maps systray2's __folioId tags to actions.
  const onMenuClick = async (action) => {
    const item = action?.item ?? {};
    const id   = item.__folioId;
    try {
      switch (id) {
        case ITEM_IDS.OPEN_FOLDER:
          if (localRoot) await openFolderImpl(localRoot);
          else log('open-folder clicked but localRoot is unset');
          break;
        case ITEM_IDS.OPEN_FOLIO:
          await openUrlImpl(baseUrl);
          break;
        case ITEM_IDS.SYNC_NOW:
          await postJson(`${baseUrl.replace(/\/$/, '')}/sync/now`, {}, { fetchImpl, log });
          break;
        case ITEM_IDS.PAUSE_RESUME: {
          const path = currentWatching ? '/watch/stop' : '/watch/start';
          await postJson(`${baseUrl.replace(/\/$/, '')}${path}`, {}, { fetchImpl, log });
          break;
        }
        case ITEM_IDS.CONFLICTS:
          await openUrlImpl(`${baseUrl.replace(/\/$/, '')}/#conflicts`);
          break;
        case ITEM_IDS.QUIT:
          await postShutdown(`${baseUrl.replace(/\/$/, '')}/shutdown`, { fetchImpl, log });
          if (onShutdown) {
            try { await onShutdown(); } catch { /* ignore */ }
          }
          // Tear the tray down too.  Don't kill the host node process —
          // the server has its own SIGINT path.
          try { await sysTray.kill(false); } catch { /* ignore */ }
          break;
        default:
          // Conflict-submenu items.
          if (typeof id === 'string' && id.startsWith('conflict-')) {
            await openUrlImpl(`${baseUrl.replace(/\/$/, '')}/#conflicts`);
          }
      }
    } catch (err) {
      log(`menu click "${id}" failed: ${err?.message ?? err}`);
    }
  };

  if (typeof sysTray.onClick === 'function') {
    try { await sysTray.onClick(onMenuClick); }
    catch (err) { log(`onClick wiring failed: ${err?.message ?? err}`); }
  }

  // ── Poll loop ────────────────────────────────────────────────────────────
  const refreshMenu = async (state) => {
    const ic = await loadIconBase64(state, {});
    lastMenu = buildMenu({
      state,
      lastSyncAt: currentSyncedAt,
      watching:   currentWatching,
      conflicts:  currentConflicts,
      iconBase64: ic,
    });
    try {
      if (typeof sysTray.sendAction === 'function') {
        await sysTray.sendAction({ type: 'update-menu', menu: lastMenu });
      }
    } catch (err) {
      log(`update-menu failed: ${err?.message ?? err}`);
    }
  };

  const tick = async () => {
    if (stopped) return;
    try {
      if (!fetchImpl) throw new Error('fetch not available — Node < 18?');
      const res = await fetchImpl(statusUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      consecutiveFails = 0;
      currentStatus    = body;
      currentWatching  = body?.watching !== false;
      currentSyncedAt  = body?.lastSyncAt ?? body?.stats?.lastSyncAt ?? currentSyncedAt;
      currentConflicts = Array.isArray(body?.conflicts)
        ? body.conflicts
        : (body?.openConflictFiles
            ? Array.from({ length: Math.min(body.openConflictFiles, 5) },
                (_, i) => ({ relPath: `conflict-${i + 1}` }))
            : []);
      const next = statusToState(body);
      if (next !== currentState) currentState = next;
      await refreshMenu(currentState);
    } catch {
      consecutiveFails++;
      if (currentState !== 'error') currentState = 'error';
      await refreshMenu('error');
    }
    if (stopped) return;
    const interval = consecutiveFails >= backoffAfter ? backoffMs : pollMs;
    timer = setTimeout(tick, interval);
    if (timer.unref) timer.unref();
  };

  // First poll runs in the next tick so callers can attach listeners first.
  timer = setTimeout(tick, 0);
  if (timer.unref) timer.unref();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        if (typeof sysTray.kill === 'function') await sysTray.kill(false);
      } catch { /* ignore */ }
    },
    _diagnostics: {
      get state()             { return currentState; },
      get consecutiveFails()  { return consecutiveFails; },
      get menu()              { return lastMenu; },
      get statusUrl()         { return statusUrl; },
      get clickUrl()          { return baseUrl; },
      get watching()          { return currentWatching; },
      get conflicts()         { return currentConflicts; },
      get lastStatus()        { return currentStatus; },
      get sysTray()           { return sysTray; },
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadSystrayClass(loader) {
  if (loader) {
    const out = await loader();
    return unwrapClass(out);
  }
  // Real systray2 — CJS default export interop.  Node's `module.exports = X`
  // → ESM `import` shape is `{ __esModule: true, default: { default: X } }`
  // (the inner `default` is the original CJS `module.exports.default`).
  const mod = await import('systray2');
  return unwrapClass(mod);
}

/**
 * Walk the {default: …} chain until we land on a constructor (function).
 * Tolerates whatever interop shape the host gives us.
 */
function unwrapClass(x) {
  let cur = x;
  for (let i = 0; i < 5 && cur && typeof cur !== 'function'; i++) {
    if (cur.SysTray && typeof cur.SysTray === 'function') return cur.SysTray;
    if (cur.default == null) break;
    cur = cur.default;
  }
  return cur;
}

async function postJson(url, body, { fetchImpl, log }) {
  if (!fetchImpl) { log(`POST ${url}: no fetch available`); return; }
  try {
    const res = await fetchImpl(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body ?? {}),
    });
    if (!res.ok) log(`POST ${url}: HTTP ${res.status}`);
    return res;
  } catch (err) {
    log(`POST ${url}: ${err?.message ?? err}`);
  }
}

async function postShutdown(url, { fetchImpl, log }) {
  if (!fetchImpl) { log(`POST ${url}: no fetch available`); return; }
  try {
    const res = await fetchImpl(url, {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        'X-Folio-Shutdown':   'true',
      },
      body: '{}',
    });
    if (!res.ok) log(`POST ${url}: HTTP ${res.status}`);
    return res;
  } catch (err) {
    log(`POST ${url}: ${err?.message ?? err}`);
  }
}

function deriveBaseUrl(statusUrl) {
  try {
    const u = new URL(statusUrl);
    u.pathname = '/';
    u.search   = '';
    u.hash     = '';
    // Trim the trailing slash so callers can append `/sync/now` cleanly.
    return u.toString().replace(/\/$/, '');
  } catch {
    return 'http://127.0.0.1:8888';
  }
}

// ─── Driver-mode (legacy mock harness) ─────────────────────────────────────
//
// Tests written against the v2.6 driver interface inject `loadDriver` and
// expect `startTray` to call `setIcon(stateName)` + wire `onClick`.  We keep
// that path alive for backwards compat — a future cleanup can drop it once
// every test migrates to `loadSystray`.

async function runInDriverMode({
  statusUrl, baseUrl, pollMs, backoffMs, backoffAfter, osName, fetchImpl,
  openUrlImpl, opts,
}) {
  const driverPath = driverNameFor(osName);
  const loadDriver = opts.loadDriver;
  const createDriver = await loadDriver(driverPath);
  const driver = await createDriver({ iconsDir: new URL('./icons/', import.meta.url) });

  const onClick = opts.onClick ?? (async () => {
    try { await openUrlImpl(baseUrl); } catch { /* swallow */ }
  });
  driver.onClick(onClick);

  let stopped         = false;
  let consecutiveFails = 0;
  let timer           = null;
  let currentState    = null;

  const setState = async (state) => {
    if (state === currentState) return;
    currentState = state;
    await Promise.resolve(driver.setIcon(STATES[state]));
  };

  const tick = async () => {
    if (stopped) return;
    try {
      if (!fetchImpl) throw new Error('fetch not available — Node < 18?');
      const res = await fetchImpl(statusUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      consecutiveFails = 0;
      await setState(statusToState(body));
    } catch {
      consecutiveFails++;
      await setState('error');
    }
    if (stopped) return;
    const interval = consecutiveFails >= backoffAfter ? backoffMs : pollMs;
    timer = setTimeout(tick, interval);
    if (timer.unref) timer.unref();
  };

  await setState('idle');
  timer = setTimeout(tick, 0);
  if (timer.unref) timer.unref();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try { await Promise.resolve(driver.destroy()); } catch { /* swallow */ }
    },
    _diagnostics: {
      get state()             { return currentState; },
      get consecutiveFails()  { return consecutiveFails; },
      get driver()            { return driver; },
      get statusUrl()         { return statusUrl; },
      get clickUrl()          { return baseUrl; },
    },
  };
}

export { ITEM_IDS };
