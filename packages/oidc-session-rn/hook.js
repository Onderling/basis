/**
 * @onderling/oidc-session-rn/hook — the React hook half of the
 * substrate.
 *
 * Imported separately so the default export (no Expo / React deps)
 * can be loaded by unit-test runners that don't have those
 * peer-deps installed (or where vitest's transform stumbles on
 * expo-auth-session's TypeScript).
 *
 * Apps integrating sign-in import from this subpath:
 *
 *   import { useOidcSignIn } from '@onderling/oidc-session-rn/hook';
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser  from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';

import { loadOrRegisterClient, clearStoredClient } from './src/dcr.js';
import {
  completeSignIn as pureCompleteSignIn,
  DEFAULT_INRUPT_ISSUER,
  DEFAULT_SCOPES,
  _resolveDiscoveryFn,
  _resolveExchangeFn,
} from './src/completeSignIn.js';

WebBrowser.maybeCompleteAuthSession();

/**
 * True when an AuthSession result/error indicates the IdP rejected
 * our DCR client_id (expired / GC'd / redirect-uri mismatch) rather
 * than the user cancelling.
 *
 * RFC 7591 dynamic clients have NO guaranteed lifetime — Inrupt GCs
 * them — and `loadOrRegisterClient` caches the id write-once in
 * SecureStore, so a stale id makes EVERY subsequent sign-in fail
 * with `invalid_client` (HTTP 401) until the cache is purged.  We
 * detect that explicit signal (never a bare cancel/dismiss, which
 * must NOT nuke a still-valid client) and self-heal.
 */
function _looksLikeStaleClient(text) {
  if (!text) return false;
  const s = String(text).toLowerCase();
  return s.includes('invalid_client')
      || s.includes('invalid client')
      || s.includes('unauthorized_client')
      || s.includes('unknown client')
      || s.includes('client not found');
}

function _resultIsStaleClient(result) {
  if (!result || result.type === 'success') return false;
  const p = result.params || {};
  return _looksLikeStaleClient(p.error)
      || _looksLikeStaleClient(p.error_description)
      || _looksLikeStaleClient(result.error?.code)
      || _looksLikeStaleClient(result.error?.message)
      || _looksLikeStaleClient(result.error?.description);
}

function _errorIsStaleClient(err) {
  if (!err) return false;
  const b = err.body || {};
  return _looksLikeStaleClient(err.code)
      || _looksLikeStaleClient(err.message)
      || _looksLikeStaleClient(err.error)
      || _looksLikeStaleClient(err.error_description)
      || _looksLikeStaleClient(b.error)
      || _looksLikeStaleClient(b.error_description);
}

const _STALE_CLIENT_MSG =
  'Your sign-in registration with the pod provider had expired; the '
  + 'app re-registered automatically. Please tap Sign in again.';

async function discoverIssuer(issuer) {
  const stub = _resolveDiscoveryFn();
  if (stub) return stub(issuer);
  return AuthSession.fetchDiscoveryAsync(issuer);
}

async function exchange(args) {
  const stub = _resolveExchangeFn();
  if (stub) return stub(args);
  return AuthSession.exchangeCodeAsync(args.config, args.discovery);
}

/**
 * The hook drives the whole sign-in flow.  See package README for
 * usage.  Pre-binds `scheme` (e.g. 'folio', 'pinboard') so the redirect
 * URI and DCR cache key are namespaced per app.
 */
export function useOidcSignIn({
  issuer    = DEFAULT_INRUPT_ISSUER,
  scheme,
  path      = 'auth/callback',
  clientId  = null,
  scopes    = DEFAULT_SCOPES,
  clientName,
  onWarning,
}) {
  if (typeof scheme !== 'string' || !scheme) {
    throw new Error('useOidcSignIn: scheme is required (e.g. "folio", "pinboard")');
  }
  const effectiveClientName = clientName ?? `${scheme} (mobile)`;

  const [discovery, setDiscovery]   = useState(null);
  const [resolvedClientId, setResolvedClientId] = useState(clientId);
  const [lastError, setLastError]   = useState(null);

  // Whether the active client_id came from the write-once SecureStore
  // cache (vs. a fresh DCR registration this session).  A cached
  // client that yields a no-redirect `dismiss` is almost certainly
  // stale/GC'd at the IdP — Inrupt shows an HTML "invalid client"
  // page rather than an OAuth error redirect, so the prompt result
  // carries NO error params and the failure is otherwise
  // indistinguishable from a user cancel.  We use this provenance
  // signal to auto-recover.  A *fresh* client that dismisses is
  // treated as a genuine cancel (no clear → no clear/cancel loop).
  const clientFromCacheRef = useRef(false);

  const redirectUri = useMemo(
    () => AuthSession.makeRedirectUri({ scheme, path, native: `${scheme}://${path}` }),
    [scheme, path],
  );

  useEffect(() => {
    let cancelled = false;
    discoverIssuer(issuer)
      .then((d) => { if (!cancelled) setDiscovery(d); })
      .catch((err) => {
        if (!cancelled) {
          setLastError(err);
          onWarning?.(`useOidcSignIn: discovery failed: ${err?.message ?? err}`);
        }
      });
    return () => { cancelled = true; };
  }, [issuer, onWarning]);

  useEffect(() => {
    if (clientId) return;
    if (!discovery) return;
    if (resolvedClientId) return;

    let cancelled = false;
    loadOrRegisterClient({
      issuer,
      discovery,
      redirectUri,
      store: SecureStore,
      clientName: effectiveClientName,
      scopes,
      keyPrefix: scheme,
      onResolve: ({ fromCache }) => { clientFromCacheRef.current = !!fromCache; },
    })
      .then((id) => {
        if (!cancelled) setResolvedClientId(id);
      })
      .catch((err) => {
        if (!cancelled) {
          setLastError(err);
          onWarning?.(`useOidcSignIn: DCR failed: ${err?.message ?? err}`);
        }
      });
    return () => { cancelled = true; };
  }, [clientId, discovery, issuer, redirectUri, resolvedClientId, scopes, scheme, effectiveClientName, onWarning]);

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId:           resolvedClientId ?? redirectUri,
      scopes,
      redirectUri,
      responseType:       AuthSession.ResponseType.Code,
      usePKCE:            true,
      codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
    },
    discovery,
  );

  const signIn = useCallback(async () => {
    if (!discovery) {
      throw Object.assign(
        new Error('useOidcSignIn: issuer discovery not yet complete'),
        { code: 'DISCOVERY_PENDING' },
      );
    }
    if (!resolvedClientId) {
      throw Object.assign(
        new Error('useOidcSignIn: client registration not yet complete'),
        { code: 'CLIENT_ID_PENDING' },
      );
    }
    if (!request) {
      throw Object.assign(
        new Error('useOidcSignIn: auth request not yet built'),
        { code: 'REQUEST_PENDING' },
      );
    }

    const recoverStaleClient = async (cause) => {
      // Purge the poisoned cache + force the DCR effect to re-register
      // a fresh client_id on the next render.  Surfaced as a typed,
      // actionable error so the app's existing error UI tells the user
      // to retry — automatic recovery, no reliance on a manual reset.
      await clearStoredClient(issuer, SecureStore, scheme).catch(() => {});
      setResolvedClientId(null);
      return Object.assign(new Error(_STALE_CLIENT_MSG), {
        code: 'AUTH_CLIENT_STALE',
        recovered: true,
        ...(cause ? { cause } : {}),
      });
    };

    const result = await promptAsync({ showInRecents: false });

    // Stale client_id rejected at the /authorize step — explicit
    // OAuth-error form (some IdPs DO redirect back with
    // `error=invalid_client`).
    if (_resultIsStaleClient(result)) {
      throw await recoverStaleClient();
    }

    // Inrupt renders an HTML "invalid client" page (HTTP 401) instead
    // of an OAuth error redirect, so an invalid client_id surfaces as
    // a bare `{type:'dismiss'}` with NO error/params — identical to a
    // user cancel.  We can't tell from the result, but we DO know the
    // client's provenance: a CACHED client_id that produces a
    // no-redirect non-success is almost certainly stale/GC'd at the
    // IdP.  Purge + force re-registration so the next tap uses a fresh
    // client.  (A FRESH client that dismisses is left as a genuine
    // cancel below — so this can't loop, and if a fresh client also
    // fails we learn it's a registration-param problem, not staleness.)
    if (result?.type !== 'success' && clientFromCacheRef.current) {
      clientFromCacheRef.current = false;
      throw await recoverStaleClient();
    }

    try {
      return await pureCompleteSignIn({
        result, request, discovery, redirectUri,
        clientId: resolvedClientId,
        issuer,
        exchange,
      });
    } catch (err) {
      // Stale client_id rejected at the /token exchange step.
      if (_errorIsStaleClient(err)) {
        throw await recoverStaleClient(err);
      }
      throw err;
    }
  }, [discovery, request, promptAsync, redirectUri, resolvedClientId, issuer, scheme]);

  const resetClient = useCallback(async () => {
    setLastError(null);
    try {
      await clearStoredClient(issuer, SecureStore, scheme);
    } catch (err) {
      onWarning?.(`useOidcSignIn.resetClient: clear failed: ${err?.message ?? err}`);
    }
    setResolvedClientId(null);
  }, [issuer, onWarning, scheme]);

  return {
    ready: !!(discovery && request && resolvedClientId),
    discovery,
    clientId: resolvedClientId,
    request,
    redirectUri,
    signIn,
    resetClient,
    lastError,
  };
}
