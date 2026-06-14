/**
 * canopy-chat-mobile — extension install controller (feedback-extension P2 mobile parity).
 *
 * Drives the consent sheet using the SHARED, tested orchestration
 * (`buildConsentModel` runs the sandbox gate + builds the plain card;
 * `installMapping` re-checks + writes to the store). A module-level +
 * `globalThis.canopyInstallExtension` trigger lets a deep link / dev tool
 * request an install — the RN analogue of web's `window.canopyInstallExtension`.
 *
 * NB (V0): the installed mapping is persisted to AsyncStorage and surfaces as a
 * slash-command on the NEXT boot (the boot wiring in agentBundle loads it). A
 * LIVE catalog refresh on mobile needs the base sources exposed from boot — a
 * clean follow-up; on web the catalog is a mutable module var so it refreshes in
 * place. `onInstalled` is the seam for that.
 */

import { useState, useCallback, useEffect } from 'react';
import { buildConsentModel, installMapping } from '../../../canopy-chat/src/v2/extensionInstall.js';

let _trigger = null;
/** Request an install from anywhere (deep link / dev tool). No-op until a screen mounts the hook. */
export function triggerInstall(mapping) { if (_trigger) _trigger(mapping); }

/**
 * @param {{ store: object, deviceId: string, catalog: {opsById: Map},
 *           onInstalled?: (mapping: object) => void }} args
 * @returns {{ consentResult: object|null, confirm: () => Promise<void>, decline: () => void }}
 */
export function useExtensionInstall({ store, deviceId, catalog, onInstalled }) {
  const [pending, setPending] = useState(null);   // { result, mapping } | null

  const requestInstall = useCallback((mapping) => {
    if (!mapping || typeof mapping !== 'object') return;
    setPending({ result: buildConsentModel(mapping, catalog), mapping });
  }, [catalog]);

  // Register the global/dev trigger while this hook is mounted.
  useEffect(() => {
    _trigger = requestInstall;
    if (typeof globalThis !== 'undefined') globalThis.canopyInstallExtension = requestInstall;
    return () => { if (_trigger === requestInstall) _trigger = null; };
  }, [requestInstall]);

  const confirm = useCallback(async () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    try {
      const r = await installMapping({ store, deviceId, mapping: p.mapping, catalog });
      if (r.ok) onInstalled?.(p.mapping);
    } catch { /* install is best-effort */ }
  }, [pending, store, deviceId, catalog, onInstalled]);

  const decline = useCallback(() => setPending(null), []);

  return { consentResult: pending?.result ?? null, confirm, decline };
}
