// project-seal.js — thin re-export of the lifted sealing substrate.
//
// The envelope crypto (per-resource CEK + X25519→HKDF recipient wrap; same `fp1:` format, same
// node:crypto construction) now lives in `packages/pod-client/src/sealing/` — lifted there for the
// household shared-pod group key (rule-of-two). This file preserves feedback's existing API verbatim
// so the 8 consumers and all on-pod envelopes are unchanged; `generateProjectKeypair` is the substrate's
// generic `generateKeypair`. Relative import (feedback-pipeline has no @canopy deps); resolves in node
// + the vite/metro builds under the flat (hoisted) node_modules layout.

export {
  recipientId, isSealed, seal, open, makeSealer, makeOpener,
  generateKeypair as generateProjectKeypair,
} from '../../../../packages/pod-client/src/sealing/envelope.js';
