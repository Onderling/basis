// deploy/box — the installer's firewall rules and the personal profile's roles.
//
// The firewall step ran `ufw allow OpenSSH`, and that ufw profile exists only with the openssh-server package: a
// machine reached over Tailscale SSH (the household tablet, 2026-09-28) has none, and the install stopped there. It
// also opened 80 and 443 on every box, and enabling ufw without an allowance for Tailscale's interface could cut
// off the only way in. The rules now come from one function in install.sh, which this test calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const INSTALL = join(resolve(import.meta.dirname, '..'), 'install.sh');

/** Run install.sh's `firewall_rules` on its own (the installer itself needs root and a network). */
function rules(roles, tailscale) {
  const src = readFileSync(INSTALL, 'utf8');
  const fn = /^firewall_rules\(\) \{[\s\S]*?^\}/m.exec(src);
  assert.ok(fn, 'install.sh defines firewall_rules()');
  const r = spawnSync('bash', ['-c', `${fn[0]}\nfirewall_rules "$1" "$2"`, '_', roles, tailscale ? '1' : '0'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean);
}

test('SSH by port number, never by the OpenSSH profile name', () => {
  for (const roles of ['caddy@basis relay@basis', 'assistant@basis']) {
    const got = rules(roles, false);
    assert.ok(got.includes('allow 22/tcp'), `${roles}: ${got}`);
    assert.ok(!got.some((l) => /OpenSSH/.test(l)), `${roles}: ${got}`);
  }
});

test('Tailscale\'s interface stays open when the machine has it', () => {
  assert.ok(rules('assistant@basis', true).includes('allow in on tailscale0'));
  assert.ok(!rules('assistant@basis', false).includes('allow in on tailscale0'));
});

test('web ports only for a box that serves the web (the caddy role)', () => {
  const web = rules('caddy@basis relay@basis', false);
  assert.ok(web.includes('allow 80/tcp') && web.includes('allow 443/tcp'), String(web));
  const personal = rules('assistant@basis', true);
  assert.ok(!personal.some((l) => /\b(80|443)\b/.test(l)), String(personal));
});

test('the installer calls the function instead of naming the rules inline', () => {
  const src = readFileSync(INSTALL, 'utf8');
  assert.ok(!/ufw allow OpenSSH/.test(src), 'the OpenSSH profile name is gone');
  assert.match(src, /firewall_rules "\$ROLES"/);
});

// The companion's local-network radio on a personal box (the household tablet, 2026-10-25): discovery is mDNS on
// 5353/udp and the hello is plain TCP on the radio's data port. With ufw on and no rule for either, a phone that
// found the box could never connect. The rules come from lib.sh, from the same box.conf that turns the radio on.
const LIB = join(resolve(import.meta.dirname, '..'), 'lib.sh');
function nearbyRules(env) {
  const src = readFileSync(LIB, 'utf8');
  const fns = ['role_names', 'nearby_port', 'lan_iface', 'nearby_firewall_rules']
    .map((n) => new RegExp(`^${n}\\(\\) \\{[\\s\\S]*?^\\}|^${n}\\(\\) \\{.*\\}$`, 'm').exec(src));
  fns.forEach((f, i) => assert.ok(f, `lib.sh defines ${['role_names', 'nearby_port', 'lan_iface', 'nearby_firewall_rules'][i]}()`));
  const r = spawnSync('bash', ['-c', `${fns.map((f) => f[0]).join('\n')}\nnearby_firewall_rules`], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean);
}

test('a box with the radio on opens mDNS and the radio\'s fixed data port ON THE LAN INTERFACE only — and nothing when it is off', () => {
  // bound to the interface the default route leaves by (the home LAN), never a bare `allow <port>`: the router's NAT
  // keeps the internet out regardless, and this keeps every other interface shut too
  assert.deepEqual(nearbyRules({ ROLES: 'companion@basis assistant@basis', COMPANION_NEARBY: 'publish:2h', LAN_IFACE: 'wlp1s0' }),
    ['allow in on wlp1s0 to any port 5353 proto udp', 'allow in on wlp1s0 to any port 45210 proto tcp']);
  assert.deepEqual(nearbyRules({ ROLES: 'companion@basis', COMPANION_NEARBY: 'browse', COMPANION_NEARBY_PORT: '45333', LAN_IFACE: 'eth0' }),
    ['allow in on eth0 to any port 5353 proto udp', 'allow in on eth0 to any port 45333 proto tcp']);
  assert.deepEqual(nearbyRules({ ROLES: 'companion@basis', COMPANION_NEARBY: 'off', LAN_IFACE: 'eth0' }), []);
  assert.deepEqual(nearbyRules({ ROLES: 'assistant@basis', COMPANION_NEARBY: 'publish', LAN_IFACE: 'eth0' }), [], 'no companion, no radio');
  // never Tailscale's interface, and never a rule without an interface
  assert.deepEqual(nearbyRules({ ROLES: 'companion@basis', COMPANION_NEARBY: 'publish', LAN_IFACE: 'tailscale0' }), []);
  assert.deepEqual(nearbyRules({ ROLES: 'companion@basis', COMPANION_NEARBY: 'publish', LAN_IFACE: '' }), []);
});

test('the installer applies the radio\'s rules for a new box (root, at install) — the updater never touches ufw', () => {
  const src = readFileSync(INSTALL, 'utf8');
  assert.match(src, /nearby_firewall_rules/, 'install.sh applies nearby_firewall_rules');
  const update = readFileSync(join(resolve(import.meta.dirname, '..'), 'update.sh'), 'utf8');
  assert.ok(!/\bufw\b/.test(update.replace(/^\s*#.*$/gm, '')), 'update.sh runs as the box user and must not touch the firewall');
});
