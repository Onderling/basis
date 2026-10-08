// J-manage: the companion-node management surface (6d), surface ① — the OWNER
// claims the node with the code it printed, then manages it by invoking owner-gated
// ops OVER THE RELAY (exactly how basis would), each call a statement signed by one
// of the owner's devices; a non-owner is denied. This is the manifest half of the
// "one contract, two projectors" design (plans/NOTE-companion-node-management.md).
import { Agent, AgentIdentity, Parts, DataPart, Bootstrap } from '@onderling/core';
import { ownerDevice }        from '../../companion-node/test/support/ownerDevice.js';
import { VaultMemory }        from '@onderling/vault';
import { RelayTransport }     from '@onderling/transports';
import { startCompanionNode } from '../../companion-node/src/index.js';
import { rm }     from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';
import { wait, checker } from './_util.mjs';

export const name = 'J-manage (companion-node management surface)';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  const cfg = join(tmpdir(), `e2e-manage-${process.pid}-${Math.floor(Math.random() * 1e6)}`);

  const ownerId    = await AgentIdentity.generate(new VaultMemory());   // the node's owner (phone role)
  const attackerId = await AgentIdentity.generate(new VaultMemory());   // a non-owner peer
  const owner    = new Agent({ identity: ownerId,    transport: new RelayTransport({ relayUrl, identity: ownerId }) });
  const attacker = new Agent({ identity: attackerId, transport: new RelayTransport({ relayUrl, identity: attackerId }) });

  const node = await startCompanionNode({
    relayUrl, configDir: cfg, gate: false,
    inbox: true, inboxOwnerPubKey: owner.address,           // a real tenant to report
    management: true,                                       // claimed below, with the code it prints
    manageHttp: true,                                       // surface ② — the online /manage web
  });
  const C = node.agent.address;
  owner.addPeer(C, C);    node.agent.addPeer(owner.address, owner.address);
  attacker.addPeer(C, C); node.agent.addPeer(attacker.address, attacker.address);
  const invoke = async (from, op, data) => Parts.data(await from.invoke(C, op, [DataPart(data ?? {})], { timeout: 9000 }));
  // the owner's phone: a device of the person's root, signing each management call
  const phone = ownerDevice(Bootstrap.create().bootstrap, 'phone');
  const signed = (op, data = {}) => ({ ...data, auth: phone.auth(C, op, data) });

  try {
    await owner.start(); await attacker.start(); await wait(1800);
    check('owner + non-owner + node on the relay',
      owner.transport.connected && attacker.transport.connected && node.agent.transport.connected);

    // The owner claims the node with the code it printed (a statement by their device).
    const claimed = await invoke(owner, 'manage.claimOwner', signed('manage.claimOwner', { code: node.claimCode() }));
    check('the owner claims the node with its code', claimed?.ok === true && node.claimCode() === null);

    // Owner manages over the relay (the basis path).
    const status = await invoke(owner, 'node.status', signed('node.status'));
    check('owner reads node.status over the relay', status?.ok === true && status.connected === true && typeof status.uptimeMs === 'number');

    const tenants = await invoke(owner, 'node.listTenants', signed('node.listTenants'));
    const sealed = (tenants?.tenants ?? []).find((t) => t.id === 'sealed-inbox');
    check('owner lists tenants (sealed-inbox reported ON)', tenants?.ok === true && sealed?.on === true);

    // A non-owner is DENIED, deny-by-default.
    const bad = await invoke(attacker, 'node.status', {});
    check('a NON-owner is denied node.status (owner-gated)', bad?.ok === false && bad?.error === 'forbidden');

    const badRevoke = await invoke(attacker, 'grant.revoke', { tokenId: 'anything' });
    check('a NON-owner is denied grant.revoke (owner-gated)', badRevoke?.ok === false && badRevoke?.error === 'forbidden');

    // The owner CAN reach grant.revoke (validates input; gate is off here so no ledger).
    const ownerRevoke = await invoke(owner, 'grant.revoke', signed('grant.revoke'));
    check('owner reaches grant.revoke (reachable + validates)', ownerRevoke?.ok === false && ownerRevoke?.error === 'tokenId required');

    // ── SURFACE ② — the online /manage web + owner-pairing flow ────────────────
    const base = (node.manageUrl ?? '').replace(/\/manage$/, '');
    check('node serves the /manage web', typeof node.manageUrl === 'string' && node.manageUrl.includes('/manage'));

    const page = await fetch(node.manageUrl);
    const html = await page.text();
    check('GET /manage serves the interface (HTML)', page.status === 200 && /Companion node/i.test(html));

    // Unauthenticated API call is refused.
    const noAuth = await fetch(`${base}/manage/api/node.status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    check('unauthenticated /manage API call is 401', noAuth.status === 401);

    // Pairing: browser starts → owner approves from the phone (over the relay) → token.
    const { code } = await (await fetch(`${base}/manage/pair/start`, { method: 'POST' })).json();
    check('browser starts pairing → gets a code', typeof code === 'string' && code.length > 0);

    const approve = await invoke(owner, 'manage.approvePairing', signed('manage.approvePairing', { code }));
    check('owner approves the browser from the phone (over the relay)', approve?.ok === true);

    const nonOwnerApprove = await invoke(attacker, 'manage.approvePairing', { code });
    check('a NON-owner cannot approve a browser (owner-gated)', nonOwnerApprove?.ok === false && nonOwnerApprove?.error === 'forbidden');

    const pairStatus = await (await fetch(`${base}/manage/pair/status?code=${encodeURIComponent(code)}`)).json();
    check('browser polls → receives a scoped session token', pairStatus?.approved === true && typeof pairStatus.token === 'string');

    // Authenticated API call now works — the web projects the SAME owner-gated op.
    const authed = await fetch(`${base}/manage/api/node.status`, {
      method: 'POST', headers: { authorization: `Bearer ${pairStatus.token}`, 'content-type': 'application/json' }, body: '{}',
    });
    const authedBody = await authed.json();
    check('paired browser reads node.status via the web API', authed.status === 200 && authedBody?.ok === true && authedBody.connected === true);
  } finally {
    await owner.transport.disconnect().catch(() => {});
    await attacker.transport.disconnect().catch(() => {});
    await node.stop?.().catch?.(() => {});
    await rm(cfg, { recursive: true, force: true }).catch(() => {});
  }
  return results;
}
