/**
 * circlePodSharing — the access model the pod actually serves.
 *
 * This module writes Solid **ACP** access-control resources (`<container>/.acr`). On a **WAC** pod
 * that PUT succeeds and authorizes nothing: WAC honours `<container>/.acl`, so the server simply
 * stores `.acr` as an ordinary file. It fails closed — a member is denied rather than over-exposed —
 * but it fails SILENTLY, with the app believing the circle is shared.
 *
 * That is not hypothetical. CSS 7.x ships WAC in both `@css:config/default.json` and
 * `@css:config/file.json`; only `file-acp.json` serves ACP. The cross-pod integration proof failed
 * for exactly this reason and passes against an ACP server, which is what these tests pin.
 */
import { describe, it, expect } from 'vitest';
import { createCirclePodSharing } from '../src/v2/circlePodSharing.js';

const OWNER  = 'https://alice.example/profile/card#me';
const MEMBER = 'https://ben.example/profile/card#me';
const CONTAINER = 'https://alice.example/circles/c1';

/** A fetch that answers HEAD with the given Link header and records every PUT. */
function fakeFetch({ link = '' } = {}) {
  const puts = [];
  const fn = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'HEAD') {
      return { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'link' ? link : null) } };
    }
    puts.push({ url, body: init.body });
    return { ok: true, status: 205, headers: { get: () => null } };
  };
  fn.puts = puts;
  return fn;
}

describe('circlePodSharing — refuses to grant against a pod that cannot honour it', () => {
  it('throws on a WAC pod, naming the control resource and the fix', async () => {
    const fetch = fakeFetch({ link: `<${CONTAINER}/.acl>; rel="acl"` });
    const sharing = createCirclePodSharing({ fetch, ownerWebId: OWNER });

    await expect(sharing.grant({ containerUri: CONTAINER, agent: MEMBER }))
      .rejects.toThrow(/WAC pod/);
    // …and it refused BEFORE writing, so nothing on the pod suggests a grant was made.
    expect(fetch.puts).toEqual([]);
  });

  it('grants on an ACP pod — the .acr carries the member and the owner keeps control', async () => {
    const fetch = fakeFetch({ link: `<${CONTAINER}/.acr>; rel="acl"` });
    const sharing = createCirclePodSharing({ fetch, ownerWebId: OWNER });

    await sharing.grant({ containerUri: CONTAINER, agent: MEMBER });
    expect(fetch.puts).toHaveLength(1);
    expect(fetch.puts[0].url).toBe(`${CONTAINER}/.acr`);
    expect(fetch.puts[0].body).toContain(MEMBER);
    expect(fetch.puts[0].body).toContain(OWNER);
    // Applied to the container AND everything in it — a member reads the items, not just the listing.
    expect(fetch.puts[0].body).toContain('acp:memberAccessControl');
  });

  it('proceeds when the pod advertises no acl link at all — absence is not evidence of WAC', async () => {
    const fetch = fakeFetch({ link: '<https://alice.example/circles/c1/.meta>; rel="describedby"' });
    const sharing = createCirclePodSharing({ fetch, ownerWebId: OWNER });

    await sharing.grant({ containerUri: CONTAINER, agent: MEMBER });
    expect(fetch.puts).toHaveLength(1);
  });

  it('checks the pod once per container, not once per grant', async () => {
    const fetch = fakeFetch({ link: `<${CONTAINER}/.acr>; rel="acl"` });
    let heads = 0;
    const counting = async (url, init = {}) => {
      if ((init.method ?? 'GET') === 'HEAD') heads += 1;
      return fetch(url, init);
    };
    counting.puts = fetch.puts;
    const sharing = createCirclePodSharing({ fetch: counting, ownerWebId: OWNER });

    await sharing.grant({ containerUri: CONTAINER, agent: MEMBER });
    await sharing.grant({ containerUri: CONTAINER, agent: 'https://cato.example/#me' });
    expect(heads).toBe(1);
    expect(fetch.puts).toHaveLength(2);
  });
});
