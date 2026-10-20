/**
 * What a circle shared out is under the admin's control on BOTH shells: the outbound list with "Stop sharing" (a
 * canonical circle only), and a removed member losing their access to it. Web had both; the phone had neither — a
 * member removed from the phone kept every share. Source pins: the RN screen cannot render under vitest.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const WEB = read('../../web/v2/circleApp.js');
const PANEL = read('../../../basis-mobile/src/screens/v2/CircleAdminPanelScreen.js');
const HOST = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');
const PODS = read('../../../basis-mobile/src/core/circlePods.js');

describe('the admin controls what the circle shared out — web ≡ mobile', () => {
  it('both decide the list and its revocability through the one shared function', () => {
    expect(WEB).toMatch(/adminOutboundShares\(/);
    expect(PODS).toMatch(/return adminOutboundShares\(/);
    expect(HOST).toMatch(/outboundFor=\{\(\) => outboundSharesForAdmin\(/);
    expect(PANEL).toMatch(/outbound\.revocable \?/);
  });
  it('both take a member\'s access back when they are removed', () => {
    expect(WEB).toMatch(/revokeAllForMember\(/);
    expect(PODS).toMatch(/return revokeAllForMember\(/);
    expect(HOST).toMatch(/revokeForRemoved=\{\(webid\) => revokeOutboundForMember\(/);
    expect(PANEL).toMatch(/if \(r\?\.ok && m\.webid && typeof revokeForRemoved === 'function'\)/);
  });
  it('both say the same words for a stop and for a removal\'s revoke', () => {
    expect(WEB).toMatch(/stopShareWords\(r, s\)/);
    expect(PANEL).toMatch(/stopShareWords\(r, s\)/);
    expect(WEB).toMatch(/memberRevokeWords\(res\)/);
    expect(PANEL).toMatch(/memberRevokeWords\(/);
  });
});
