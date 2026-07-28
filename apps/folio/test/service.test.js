/**
 * service.test.js — unit tests for `folio install-service` / `uninstall-service` /
 * `service-status` across launchd / systemd / Task Scheduler.
 *
 * Strategy:
 *   - All three platform modules are tested in-process with a stubbed `exec`.
 *     We never spawn `launchctl` / `systemctl` / `schtasks`; tests just record
 *     the commands that would run and assert on the generated unit-file
 *     content.
 *   - The CLI command tests inject the platform module via `__deps.service`,
 *     so the same test passes regardless of the host OS.
 *   - File-system effects (writing the plist / .service / sentinel) target
 *     a temp dir via env-var overrides (HOME / XDG_CONFIG_HOME / etc.).
 *
 * Coverage map (10 tests):
 *   1.  launchd.buildUnit produces a syntactically valid plist containing
 *       absolute paths, `RunAtLoad`, `KeepAlive`, label, log path.
 *   2.  systemd.buildUnit produces an INI-shaped unit with [Unit]/[Service]/
 *       [Install], ExecStart absolute paths, Restart=on-failure, log append.
 *   3.  windows.buildUnit produces a `schtasks /Create … /SC ONLOGON /RL LIMITED /F`
 *       command with quoted absolute paths.
 *   4.  install + uninstall (launchd) round-trip — file written, exec called,
 *       file removed, idempotent uninstall.
 *   5.  install + uninstall (systemd) round-trip — daemon-reload + enable --now.
 *   6.  Idempotent install (second call detects existing unit, returns
 *       alreadyInstalled=true).
 *   7.  service-status returns "not-installed" when no unit exists.
 *   8.  service-status returns "running" when launchctl/systemctl/schtasks
 *       reports an active PID / "active" / "Status: Running".
 *   9.  CLI: install-service refuses (exit 2) when no Folio config exists.
 *  10.  CLI: install-service with config writes the unit and prints success.
 *  11.  CLI: uninstall-service is idempotent (exits 0 when not installed).
 *  12.  CLI: service-status --json emits structured output (state, unitPath,
 *       lastLogLines).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir }         from 'node:os';
import { join }           from 'node:path';

import * as launchd from '../src/service/launchd.js';
import * as systemd from '../src/service/systemd.js';
import * as windows from '../src/service/windows.js';

import { installServiceCmd }   from '../src/cli/installServiceCmd.js';
import { uninstallServiceCmd } from '../src/cli/uninstallServiceCmd.js';
import { serviceStatusCmd }    from '../src/cli/serviceStatusCmd.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Sandboxed env for a single test.  Restores prior values on teardown. */
function envSandbox() {
  const saved = {};
  return {
    set(k, v) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else                 process.env[k] = v;
    },
    restore() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else                 process.env[k] = v;
      }
    },
  };
}

/** Mute process.stdout for the duration of a single in-process call. */
function muteStdout() {
  const buf = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    if (typeof chunk === 'string') buf.push(chunk);
    else if (chunk) buf.push(chunk.toString('utf8'));
    return true;
  };
  return {
    text: () => buf.join(''),
    restore: () => { process.stdout.write = orig; },
  };
}

/** Mute process.stderr similarly. */
function muteStderr() {
  const buf = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    if (typeof chunk === 'string') buf.push(chunk);
    else if (chunk) buf.push(chunk.toString('utf8'));
    return true;
  };
  return {
    text: () => buf.join(''),
    restore: () => { process.stderr.write = orig; },
  };
}

/** A recording stub for `exec` that lets each test program-in responses. */
function makeExecStub({ responses = {}, fail = false } = {}) {
  const calls = [];
  async function exec(cmd) {
    calls.push(cmd);
    // Allow per-test overrides via responses keyed by a regex-match string.
    for (const [pattern, value] of Object.entries(responses)) {
      if (cmd.includes(pattern)) {
        if (value instanceof Error) throw value;
        return value;
      }
    }
    if (fail) {
      const e = new Error(`stub: refused: ${cmd}`);
      e.stdout = '';
      e.stderr = 'stub: refused';
      throw e;
    }
    return { stdout: '', stderr: '' };
  }
  exec.calls = calls;
  return exec;
}

let HOME;
let env;

beforeEach(async () => {
  HOME = await fs.mkdtemp(join(tmpdir(), 'folio-svc-home-'));
  env  = envSandbox();
  env.set('HOME',             HOME);
  env.set('XDG_CONFIG_HOME',  join(HOME, '.config'));
  env.set('XDG_CACHE_HOME',   join(HOME, '.cache'));
  env.set('LOCALAPPDATA',     join(HOME, 'AppData', 'Local'));
});

afterEach(async () => {
  env.restore();
  try { await fs.rm(HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── 1. launchd plist content ───────────────────────────────────────────────

describe('launchd.buildUnit', () => {
  it('produces a valid plist with absolute paths + RunAtLoad + KeepAlive', () => {
    const plist = launchd.buildUnit({
      nodePath:   '/usr/local/bin/node',
      cliPath:    '/Users/alice/canopy/apps/folio/src/cli.js',
      workingDir: '/Users/alice/notes',
      logPath:    '/Users/alice/Library/Logs/folio/folio.log',
    });
    // Header.
    expect(plist).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(plist).toContain('<!DOCTYPE plist PUBLIC');
    expect(plist).toContain('<plist version="1.0">');
    // Required keys.
    expect(plist).toContain('<key>Label</key>');
    expect(plist).toContain('<string>org.onderling.folio</string>');
    expect(plist).toContain('<key>ProgramArguments</key>');
    expect(plist).toContain('<string>/usr/local/bin/node</string>');
    expect(plist).toContain('<string>/Users/alice/canopy/apps/folio/src/cli.js</string>');
    expect(plist).toContain('<string>serve</string>');
    expect(plist).toContain('<string>--watch</string>');
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<true/>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<key>WorkingDirectory</key>');
    expect(plist).toContain('<string>/Users/alice/notes</string>');
    expect(plist).toContain('<key>StandardOutPath</key>');
    expect(plist).toContain('<key>StandardErrorPath</key>');
    expect(plist).toContain('<string>/Users/alice/Library/Logs/folio/folio.log</string>');
    // Closes.
    expect(plist).toMatch(/<\/plist>\n?$/);
  });

  it('escapes XML in path values', () => {
    const plist = launchd.buildUnit({
      nodePath:   '/with & ampersand/node',
      cliPath:    '/<weird>/cli.js',
      workingDir: '/quotes"and\'apos/here',
    });
    expect(plist).toContain('/with &amp; ampersand/node');
    expect(plist).toContain('/&lt;weird&gt;/cli.js');
    expect(plist).toContain('/quotes&quot;and&apos;apos/here');
  });
});

// ── 2. systemd unit content ─────────────────────────────────────────────────

describe('systemd.buildUnit', () => {
  it('produces an INI-shaped unit with the right sections and keys', () => {
    const unit = systemd.buildUnit({
      nodePath:   '/usr/bin/node',
      cliPath:    '/home/alice/canopy/apps/folio/src/cli.js',
      workingDir: '/home/alice/notes',
      logPath:    '/home/alice/.cache/folio/folio.log',
    });
    expect(unit).toContain('[Unit]');
    expect(unit).toContain('Description=Folio');
    expect(unit).toContain('After=network-online.target');
    expect(unit).toContain('[Service]');
    expect(unit).toContain('Type=simple');
    expect(unit).toContain(
      'ExecStart=/usr/bin/node /home/alice/canopy/apps/folio/src/cli.js serve --watch',
    );
    expect(unit).toContain('WorkingDirectory=/home/alice/notes');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('StandardOutput=append:/home/alice/.cache/folio/folio.log');
    expect(unit).toContain('StandardError=append:/home/alice/.cache/folio/folio.log');
    expect(unit).toContain('[Install]');
    expect(unit).toContain('WantedBy=default.target');
  });
});

// ── 3. Task Scheduler command shape ─────────────────────────────────────────

describe('windows.buildUnit', () => {
  it('produces a schtasks command with ONLOGON + LIMITED + force overwrite', () => {
    const cmd = windows.buildUnit({
      nodePath:   'C:\\Program Files\\nodejs\\node.exe',
      cliPath:    'C:\\Users\\alice\\canopy\\apps\\folio\\src\\cli.js',
      workingDir: 'C:\\Users\\alice\\notes',
    });
    expect(cmd).toMatch(/^schtasks /);
    expect(cmd).toContain('/Create');
    expect(cmd).toContain('/TN "Folio"');
    expect(cmd).toContain('/SC ONLOGON');
    expect(cmd).toContain('/RL LIMITED');
    expect(cmd).toContain('/F');
    // The TR (TaskRun) string contains the absolute paths and `serve --watch`.
    expect(cmd).toContain('node.exe');
    expect(cmd).toContain('cli.js');
    expect(cmd).toContain('serve --watch');
  });
});

// ── 4. launchd install + uninstall round-trip ───────────────────────────────

describe('launchd install + uninstall', () => {
  it('writes the plist, calls launchctl load, and uninstalls cleanly', async () => {
    const exec = makeExecStub();
    const result = await launchd.install({
      nodePath:   '/usr/local/bin/node',
      cliPath:    '/abs/cli.js',
      workingDir: '/abs/notes',
      exec,
    });
    expect(result.alreadyInstalled).toBe(false);
    // Plist on disk matches the expected path.
    expect(result.unitPath).toBe(launchd.unitPath());
    const content = await fs.readFile(result.unitPath, 'utf8');
    expect(content).toContain('org.onderling.folio');
    expect(content).toContain('/usr/local/bin/node');
    expect(content).toContain('/abs/cli.js');
    // Exec saw a `launchctl load <path>` call.
    expect(exec.calls.some((c) => c.startsWith('launchctl load'))).toBe(true);

    // Uninstall: removes file, calls launchctl unload, idempotent.
    await launchd.uninstall({ exec });
    await expect(fs.access(result.unitPath)).rejects.toThrow();
    expect(exec.calls.some((c) => c.startsWith('launchctl unload'))).toBe(true);

    // Second uninstall is a no-op (no throw).
    await launchd.uninstall({ exec });
  });
});

// ── 5. systemd install + uninstall round-trip ───────────────────────────────

describe('systemd install + uninstall', () => {
  it('writes the unit, runs daemon-reload + enable --now, removes cleanly', async () => {
    const exec = makeExecStub();
    const result = await systemd.install({
      nodePath:   '/usr/bin/node',
      cliPath:    '/home/alice/cli.js',
      workingDir: '/home/alice/notes',
      exec,
    });
    expect(result.alreadyInstalled).toBe(false);
    expect(result.unitPath).toBe(systemd.unitPath());
    const content = await fs.readFile(result.unitPath, 'utf8');
    expect(content).toContain('ExecStart=/usr/bin/node /home/alice/cli.js serve --watch');

    expect(exec.calls).toContain('systemctl --user daemon-reload');
    expect(exec.calls.some((c) => c.includes('enable --now folio.service'))).toBe(true);

    await systemd.uninstall({ exec });
    await expect(fs.access(result.unitPath)).rejects.toThrow();
    expect(exec.calls.some((c) => c.includes('disable --now folio.service'))).toBe(true);

    // Second uninstall is a no-op.
    await systemd.uninstall({ exec });
  });
});

// ── 6. Idempotent install ───────────────────────────────────────────────────

describe('idempotent install', () => {
  it('reports alreadyInstalled=true on the second launchd install', async () => {
    const exec = makeExecStub();
    const args = {
      nodePath: '/usr/local/bin/node', cliPath: '/abs/cli.js', workingDir: '/abs/notes',
    };
    const r1 = await launchd.install({ ...args, exec });
    expect(r1.alreadyInstalled).toBe(false);
    const r2 = await launchd.install({ ...args, exec });
    expect(r2.alreadyInstalled).toBe(true);
    // File still exists.
    await fs.access(r2.unitPath);
  });

  it('reports alreadyInstalled=true on the second systemd install', async () => {
    const exec = makeExecStub();
    const args = {
      nodePath: '/usr/bin/node', cliPath: '/home/alice/cli.js', workingDir: '/home/alice/notes',
    };
    const r1 = await systemd.install({ ...args, exec });
    expect(r1.alreadyInstalled).toBe(false);
    const r2 = await systemd.install({ ...args, exec });
    expect(r2.alreadyInstalled).toBe(true);
  });
});

// ── 7-8. Status ──────────────────────────────────────────────────────────

describe('service status', () => {
  it('reports not-installed when no unit file exists (launchd)', async () => {
    const exec = makeExecStub();
    const s = await launchd.status({ exec });
    expect(s.state).toBe('not-installed');
    expect(s.lastLogLines).toEqual([]);
  });

  it('reports running when launchctl list shows an active PID', async () => {
    const exec = makeExecStub({
      responses: {
        'launchctl list': { stdout: '{\n\t"PID" = 12345;\n\t"Label" = "org.onderling.folio";\n}', stderr: '' },
      },
    });
    await launchd.install({
      nodePath: '/usr/local/bin/node', cliPath: '/abs/cli.js', workingDir: '/abs', exec,
    });
    const s = await launchd.status({ exec });
    expect(s.state).toBe('running');
    expect(s.detail).toMatch(/"PID" = 12345/);
  });

  it('reports running when systemctl is-active = active', async () => {
    const exec = makeExecStub({
      responses: { 'is-active folio.service': { stdout: 'active\n', stderr: '' } },
    });
    await systemd.install({
      nodePath: '/usr/bin/node', cliPath: '/home/alice/cli.js', workingDir: '/home/alice', exec,
    });
    const s = await systemd.status({ exec });
    expect(s.state).toBe('running');
    expect(s.detail).toBe('active');
  });

  it('reports stopped when systemctl is-active errors with inactive', async () => {
    const ex = new Error('non-zero exit');
    ex.stdout = 'inactive\n';
    ex.stderr = '';
    const exec = makeExecStub({
      responses: { 'is-active folio.service': ex },
    });
    await systemd.install({
      nodePath: '/usr/bin/node', cliPath: '/home/alice/cli.js', workingDir: '/home/alice', exec,
    });
    const s = await systemd.status({ exec });
    expect(s.state).toBe('stopped');
    expect(s.detail).toBe('inactive');
  });
});

// ── 9. CLI: install-service refuses without config ──────────────────────────

describe('CLI install-service — no config', () => {
  it('exits 2 with a clear error when no Folio config exists', async () => {
    const cfgDir = await fs.mkdtemp(join(tmpdir(), 'folio-svc-cfg-'));
    env.set('FOLIO_CONFIG_DIR', cfgDir);

    const muted = muteStderr();
    const mutedOut = muteStdout();
    process.exitCode = 0;
    try {
      await installServiceCmd([], {
        __deps: { service: stubService(), exec: makeExecStub() },
      });
      expect(process.exitCode).toBe(2);
      expect(muted.text()).toMatch(/no Folio config/);
    } finally {
      muted.restore();
      mutedOut.restore();
      process.exitCode = 0;
      await fs.rm(cfgDir, { recursive: true, force: true });
    }
  });
});

// ── 10. CLI: install-service with config ────────────────────────────────────

describe('CLI install-service — with config', () => {
  it('writes the unit and prints success', async () => {
    const cfgDir = await fs.mkdtemp(join(tmpdir(), 'folio-svc-cfg-'));
    const localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-svc-loc-'));
    env.set('FOLIO_CONFIG_DIR', cfgDir);
    await fs.writeFile(join(cfgDir, 'config.json'), JSON.stringify({
      localRoot, podRoot: 'https://alice.example/notes/', vaultPath: join(cfgDir, 'vault.json'),
    }), 'utf8');

    const fakeService = stubService({ runningAfterInstall: true });
    const muted = muteStdout();
    process.exitCode = 0;
    try {
      await installServiceCmd([], {
        __deps: {
          service: fakeService,
          exec:    makeExecStub(),
          sleep:   () => Promise.resolve(),
          now:     fakeNow(),
        },
      });
      expect(fakeService.installCalls.length).toBe(1);
      const call = fakeService.installCalls[0];
      expect(call.nodePath).toBe(process.execPath);
      expect(call.cliPath).toMatch(/cli\.js$/);
      expect(call.workingDir).toBe(localRoot);
      const text = muted.text();
      expect(text).toMatch(/installed/);
      expect(text).toMatch(/status = running/);
    } finally {
      muted.restore();
      await fs.rm(cfgDir,    { recursive: true, force: true });
      await fs.rm(localRoot, { recursive: true, force: true });
    }
  });

  it('detects already-installed and prints reload message', async () => {
    const cfgDir    = await fs.mkdtemp(join(tmpdir(), 'folio-svc-cfg-'));
    const localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-svc-loc-'));
    env.set('FOLIO_CONFIG_DIR', cfgDir);
    await fs.writeFile(join(cfgDir, 'config.json'), JSON.stringify({
      localRoot, podRoot: 'https://alice.example/notes/',
    }), 'utf8');

    const fakeService = stubService({ alreadyInstalled: true, runningAfterInstall: true });
    const muted = muteStdout();
    try {
      await installServiceCmd([], {
        __deps: { service: fakeService, exec: makeExecStub(), sleep: () => Promise.resolve(), now: fakeNow() },
      });
      const text = muted.text();
      expect(text).toMatch(/already installed/);
    } finally {
      muted.restore();
      await fs.rm(cfgDir,    { recursive: true, force: true });
      await fs.rm(localRoot, { recursive: true, force: true });
    }
  });
});

// ── 11. CLI: uninstall-service idempotent ───────────────────────────────────

describe('CLI uninstall-service — idempotent', () => {
  it('exits 0 when nothing is installed (does not call uninstall)', async () => {
    const fakeService = stubService({ initiallyInstalled: false });
    const muted = muteStdout();
    process.exitCode = 0;
    try {
      await uninstallServiceCmd([], {
        __deps: { service: fakeService, exec: makeExecStub() },
      });
      expect(fakeService.uninstallCalls.length).toBe(0);
      expect(muted.text()).toMatch(/nothing to do/);
      expect(process.exitCode).toBe(0);
    } finally {
      muted.restore();
      process.exitCode = 0;
    }
  });

  it('runs uninstall when state was running', async () => {
    const fakeService = stubService({ initiallyInstalled: true, runningAfterInstall: true });
    const muted = muteStdout();
    try {
      await uninstallServiceCmd([], {
        __deps: { service: fakeService, exec: makeExecStub() },
      });
      expect(fakeService.uninstallCalls.length).toBe(1);
      expect(muted.text()).toMatch(/removed/);
    } finally {
      muted.restore();
    }
  });
});

// ── 12. CLI: service-status --json ──────────────────────────────────────────

describe('CLI service-status --json', () => {
  it('emits a structured JSON object with state + unitPath + lastLogLines', async () => {
    const fakeService = stubService({ initiallyInstalled: true, runningAfterInstall: true });
    const muted = muteStdout();
    process.exitCode = 0;
    try {
      await serviceStatusCmd(['--json'], {
        __deps: { service: fakeService, exec: makeExecStub() },
      });
      const out = muted.text();
      const parsed = JSON.parse(out);
      expect(parsed.state).toBe('running');
      expect(parsed.unitPath).toBe(fakeService.unitPath());
      expect(parsed.logPath).toBe(fakeService.logPath());
      expect(Array.isArray(parsed.lastLogLines)).toBe(true);
      expect(process.exitCode).toBe(0);
    } finally {
      muted.restore();
      process.exitCode = 0;
    }
  });

  it('exits 1 when state is stopped', async () => {
    const fakeService = stubService({ initiallyInstalled: true, runningAfterInstall: false });
    const muted = muteStdout();
    process.exitCode = 0;
    try {
      await serviceStatusCmd([], {
        __deps: { service: fakeService, exec: makeExecStub() },
      });
      expect(process.exitCode).toBe(1);
    } finally {
      muted.restore();
      process.exitCode = 0;
    }
  });
});

// ── stubService helper ─────────────────────────────────────────────────────

/**
 * Build a fake platform-service module with controlled state.  Tests can
 * configure `initiallyInstalled` (initial status), `alreadyInstalled` (return
 * value of install()), and `runningAfterInstall` (status reported once
 * something is "installed" via the stub's internal flag).
 */
function stubService({
  initiallyInstalled = false,
  alreadyInstalled  = false,
  runningAfterInstall = false,
} = {}) {
  let installed = initiallyInstalled;
  const installCalls   = [];
  const uninstallCalls = [];
  return {
    id: 'fake.folio',
    unitPath: () => '/fake/unit/path',
    logPath:  () => '/fake/log/path',
    buildUnit: () => '<fake-unit/>',
    install: async (args) => {
      installCalls.push(args);
      installed = true;
      return { alreadyInstalled, unitPath: '/fake/unit/path', logPath: '/fake/log/path' };
    },
    uninstall: async (args) => {
      uninstallCalls.push(args);
      installed = false;
      return { unitPath: '/fake/unit/path' };
    },
    status: async () => ({
      state: installed
        ? (runningAfterInstall ? 'running' : 'stopped')
        : 'not-installed',
      detail: installed ? (runningAfterInstall ? 'active' : 'inactive') : 'no unit',
      lastLogLines: installed ? ['log line 1', 'log line 2'] : [],
    }),
    installCalls,
    uninstallCalls,
  };
}

/** Monotonic now for deterministic poll loops. */
function fakeNow() {
  let t = 0;
  return () => { t += 100; return t; };
}
