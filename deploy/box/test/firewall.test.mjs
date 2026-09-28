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
