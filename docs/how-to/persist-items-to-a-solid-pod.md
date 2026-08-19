# How to persist items to a Solid pod

[Tutorial 3](../tutorials/03-compatible-tasks-app.md) runs `ItemStore` over
`memoryDataSource()`. This guide points the same store at a **real Solid pod** — optionally
sealed so the pod host only ever stores ciphertext.

## 1. Get an authenticated fetch

In Node, `SolidVault` handles the Solid-OIDC session and hands you a fetch bound to it
(browser and mobile apps use the redirect flow instead — `createSolidAuthNode` in the same
package, or `@onderling/oidc-session-rn`):

```js
import { SolidVault } from '@onderling/oidc-session';

const vault = new SolidVault({
  webid:      'https://alice.solidcommunity.net/profile/card#me',
  oidcIssuer: 'https://solidcommunity.net',
});
await vault.login({ clientId, clientSecret });   // pre-registered client credentials

const authedFetch = vault.getAuthenticatedFetch();
const podRoot     = await vault.getPodRoot();     // reads pim:storage from the WebID profile
```

## 2. Build a pod-backed data source

`ItemStore` consumes the kernel's plain `DataSource` shape (`read` → string or `null`,
`list` → an array of URIs). The raw `SolidPodSource` returns richer results (bytes plus etag
metadata), so don't hand it to the store directly — `createSealedPodDataSource` adapts it to
exactly the shape the store expects:

```js
import { createSealedPodDataSource } from '@onderling/pod-client';
import { ItemStore } from '@onderling/item-store';

const dataSource = createSealedPodDataSource({ podUrl: podRoot, fetch: authedFetch });

const store = new ItemStore({
  dataSource,
  rootContainer: `${podRoot}my-app/tasks/`,   // absolute https URI under the pod root
});
```

Without a sealing strategy this stores plaintext JSON on the pod (`dataSource.sealed` is
`false`). Pod sources refuse logical schemes like `mem://` by design — use absolute URIs.

## 3. Use the store — nothing else changes

```js
const [task] = await store.addItems([{ type: 'task', text: 'Paint the fence' }], { actor: aliceWebId });
await store.claim(task.id, { actor: bobWebId });
await store.markComplete([{ id: task.id }], { actor: bobWebId });
await store.auditLog({ itemId: task.id });   // actions → ['add', 'claim', 'complete']
```

Items land as one JSON resource each under `<rootContainer>items/`, audit entries under
`<rootContainer>audit/` — canonical shapes a Basis client reads unchanged.

## 4. Seal content at rest (optional)

Pass a storage posture and a group key, and every body is encrypted client-side — the pod
host stores only ciphertext:

```js
import { createSealedPodDataSource, generateGroupKey } from '@onderling/pod-client';

const groupKey = generateGroupKey();
const sealed = createSealedPodDataSource({
  podUrl:  podRoot,
  fetch:   authedFetch,
  posture: 'p2',        // client-side end-to-end, group key
  groupKey,
});
```

Use `sealed` as the `dataSource` above; the `ItemStore` code is unchanged. Key custody is
yours: keep the group key in an `@onderling/vault` store, never on the pod it seals.

## Limits to know

- **Claim races across devices** resolve last-writer-wins at the pod layer: this data source
  does not forward `If-Match` preconditions, so the store's compare-and-swap is best-effort
  once two devices race on the same item.
- **Latency**: every operation is an HTTP round trip. Production apps put a local cache in
  front and sync on a cadence ("pod is truth, local cache is reality").
- **Offline development**: `@onderling/pseudo-pod` gives the same Solid-shaped behaviour fully
  in memory — see journey J4 in [`apps/sdk-journeys/`](../../apps/sdk-journeys/).

Related: [`pod-client`](../../packages/pod-client/README.md) · [`item-store`](../../packages/item-store/README.md) READMEs.
