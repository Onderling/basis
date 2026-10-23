/**
 * Port conformance harness — the executable form of the `@onderling/core`
 * compatibility contract (see docs/conventions/ports.md).
 *
 * A third party (or another `@onderling/*` package) writing an adapter proves it
 * satisfies a port by wiring the matching `assert…Conformance` helper into its
 * own test suite:
 *
 *   import { assertTransportConformance } from '@onderling/core/conformance';
 *
 * Peer requirement: these helpers assert via `vitest`'s `expect`, so they are
 * consumed from a `vitest` test (vitest is a peer of this subpath). They are
 * otherwise runner-agnostic — they only take factories and assert.
 */
export {
  assertTransportConformance,
  assertSenderBindingConformance,
  REQUIRED_TRANSPORT_METHODS,
} from './transportConformance.js';

export {
  assertDataSourceConformance,
  REQUIRED_DATASOURCE_METHODS,
} from './dataSourceConformance.js';

export {
  assertStorageBackendConformance,
  REQUIRED_STORAGE_BACKEND_METHODS,
} from './storageBackendConformance.js';

export {
  assertActorResolverConformance,
} from './actorResolverConformance.js';
