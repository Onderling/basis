/**
 * BleTransport — bidirectional BLE transport.
 *
 * Central mode (scan=true):
 *   Uses react-native-ble-plx to scan, connect, and write to nearby peers.
 *   Peers are keyed by their agent pubKey after the first received envelope.
 *
 * Peripheral mode (advertise=true):
 *   Uses the custom BlePeripheralModule native module (Kotlin GATT server)
 *   to advertise SERVICE_UUID and accept inbound connections from central peers.
 *   Receives data via GATT writes (BlePeripheralWrite events).
 *   Sends data back via GATT notifications (BlePeripheral.notify()).
 *
 * Both modes can be active simultaneously (default). Data flows over the same
 * SERVICE_UUID / CHARACTERISTIC_UUID on either side.
 *
 * MTU chunking: payloads larger than (mtu - 3) bytes are split into chunks.
 * The first chunk carries a 4-byte big-endian total-length header; subsequent
 * chunks are raw data. Chunks are base64-encoded (react-native-ble-plx framing).
 *
 * Service UUID:        a8f0e4d2-0001-4b3f-8c9a-1e2d3f4a5b6c
 * Characteristic UUID: b1c3e5a7-0002-4f8e-9d0b-2c3e4a5f6b7d
 *
 * ── To disable BleTransport entirely ─────────────────────────────────────────
 * In apps/mesh-demo/src/agent.js, comment out the ble block:
 *   // if (perms.ble) { ble = new BleTransport(...); }
 *
 * ── To disable only peripheral (advertise) mode ───────────────────────────────
 * Pass advertise: false:
 *   new BleTransport({ identity, advertise: false, scan: true })
 *
 * Peer dependencies: react-native-ble-plx, BlePeripheralModule (built-in native)
 */
import { BleManager, State }             from 'react-native-ble-plx';
import { NativeModules, NativeEventEmitter } from 'react-native';
import { Transport, DISCOVERABILITY }    from '@onderling/core';
import { b64Encode, b64Decode }          from '../utils/base64.js';

export const SERVICE_UUID        = 'a8f0e4d2-0001-4b3f-8c9a-1e2d3f4a5b6c';
export const CHARACTERISTIC_UUID = 'b1c3e5a7-0002-4f8e-9d0b-2c3e4a5f6b7d';

const DEFAULT_MTU = 20;  // bytes; most devices negotiate higher (up to 512)

// Native peripheral module — null if the Kotlin module is not present.
const BlePeripheral = NativeModules.BlePeripheral ?? null;
const peripheralEmitter = BlePeripheral ? new NativeEventEmitter(BlePeripheral) : null;

export class BleTransport extends Transport {
  #manager;
  #advertise;
  #scan;
  // Whether the peripheral (advertising) half is actually RUNNING — distinct from #advertise, which is
  // only the intent. connect() can want to advertise and fail to, when the native module is absent.
  #advertisingActive = false;

  // Central-mode peers: pubKey → { device, char, mtu, rxBuffer }
  #centralPeers  = new Map();

  // Device IDs currently in the middle of async connect — guards against the
  // race where BLE emits a second scan result for the same device before the
  // first connect() call completes.
  #connectingDevices = new Set();

  // Per-peer write queue: BLE only supports one GATT operation at a time per
  // connection.  Concurrent writes (e.g. ping + message send) cause "operation
  // was rejected".  We chain each write behind the previous one per peer key.
  #writeQueues = new Map();

  // Store-and-forward buffer for messages sent while a peer is (temporarily)
  // not connected. Drained FIFO when the peer re-appears. See Group V.
  #pendingForPeer    = new Map();   // pubKey → Array<{ payload, enqueuedAt }>
  #bufferMaxPerPeer  = 50;
  #bufferTtlMs       = 5 * 60_000;

  // Peripheral-mode peers: pubKey → { deviceAddress, mtu, rxBuffer }
  // Keyed by device address until first envelope arrives, then re-keyed to pubKey.
  #peripheralByAddress = new Map();  // deviceAddress → state (unidentified)
  #peripheralByPubKey  = new Map();  // pubKey → state (after first message)

  // Event subscriptions to clean up in disconnect()
  #eventSubs = [];

  // True once connect() has been called successfully. Used to guard scan restarts.
  #started = false;

  /**
   * @param {object} opts
   * @param {import('@onderling/core').AgentIdentity} opts.identity
   * @param {boolean} [opts.advertise=true]        — start GATT server and advertise
   * @param {boolean} [opts.scan=true]             — scan and connect to nearby peripherals
   * @param {number}  [opts.bufferMaxPerPeer=50]   — cap on queued messages per offline peer
   * @param {number}  [opts.bufferTtlMs=300_000]   — drop queued messages older than this on drain
   */
  constructor({ identity, advertise = true, scan = true, bufferMaxPerPeer, bufferTtlMs } = {}) {
    if (!identity) throw new Error('BleTransport requires identity');
    super({ address: identity.pubKey, identity });
    this.#manager   = new BleManager();
    this.#advertise = advertise;
    this.#scan      = scan;
    if (typeof bufferMaxPerPeer === 'number') this.#bufferMaxPerPeer = bufferMaxPerPeer;
    if (typeof bufferTtlMs      === 'number') this.#bufferTtlMs      = bufferTtlMs;
  }

  async connect() {
    // Wait for BLE radio to be ready
    const state = await this.#manager.state();
    if (state !== State.PoweredOn) {
      await new Promise((resolve, reject) => {
        const sub = this.#manager.onStateChange(s => {
          if (s === State.PoweredOn)                              { sub.remove(); resolve(); }
          if (s === State.PoweredOff || s === State.Unauthorized) { sub.remove(); reject(new Error(`BLE state: ${s}`)); }
        }, true);
      });
    }

    this.#started = true;

    // ── Central mode: scan for peers ────────────────────────────────────────
    if (this.#scan) this.#startScan();

    // ── Peripheral mode: advertise and accept inbound connections ────────────
    if (this.#advertise) {
      if (!BlePeripheral) {
        console.warn(
          'BleTransport: advertise=true but BlePeripheralModule is not available. ' +
          'Make sure BlePeripheralPackage is registered in MainApplication.kt.'
        );
      } else {
        await BlePeripheral.start(SERVICE_UUID, CHARACTERISTIC_UUID);
        this.#setupPeripheralEvents();
        this.#advertisingActive = true;
      }
    }
  }

  async disconnect() {
    this.#started = false;
    // Clean up event subscriptions
    for (const sub of this.#eventSubs) sub.remove();
    this.#eventSubs = [];

    // Stop scanning / close central connections
    this.#manager.stopDeviceScan();
    this.#connectingDevices.clear();
    this.#writeQueues.clear();
    for (const peer of this.#centralPeers.values()) {
      await peer.device?.cancelConnection().catch(() => {});
    }
    this.#centralPeers.clear();

    // Stop peripheral
    if (this.#advertisingActive && BlePeripheral) {
      await BlePeripheral.stop().catch(() => {});
    }
    this.#advertisingActive = false;
    this.#peripheralByAddress.clear();
    this.#peripheralByPubKey.clear();
    this.#pendingForPeer.clear();

    // Intentionally NOT calling this.#manager.destroy():
    // destroy() is ble-plx's "I'm permanently done with BLE" call and
    // puts Android's BLE stack into a heavy teardown state that can
    // persist for several seconds.  When we just want to restart the
    // agent (e.g. after forgetPeers), a fresh BleTransport creates its
    // own BleManager — the old one is GC'd cleanly, no global stack
    // hostile state lingers, and a fresh scan on the new transport
    // works immediately.
  }

  // ── Discoverability (Nearby step A) ─────────────────────────────────────────
  //
  // BLE is the transport that can already honour all three states: `advertise` and `scan` are separate
  // halves here, so ghost mode works TODAY. What this adds is the ability to change them at runtime — until
  // now both were fixed at construction, which means "stop advertising when the Nearby view closes" was
  // only expressible by tearing the transport down and losing every live GATT connection with it.
  //
  // Note the asymmetry with mDNS: BLE advertising has NO network boundary. mDNS is confined to a LAN; a BLE
  // peripheral announces to anyone within radio range, including people who are not on your Wi-Fi and never
  // will be. That is why the room's defaults must be tighter here, and why enabling BLE in basis is gated
  // behind its own design pass (Nearby step J) rather than following mDNS by default.

  get supportsDiscoverability() { return true; }

  /** @protected */
  async _applyDiscoverability(state) {
    const wantScan      = state !== DISCOVERABILITY.OFF;
    const wantAdvertise = state === DISCOVERABILITY.PUBLISH;

    if (state === DISCOVERABILITY.OFF) {
      this.#advertise = false;
      this.#scan      = false;
      await this.disconnect();
      return DISCOVERABILITY.OFF;
    }

    // Not started yet: record the halves and let connect() apply them.
    this.#scan      = wantScan;
    this.#advertise = wantAdvertise;
    if (!this.#started) {
      await this.connect();
      // connect() may have warned that the peripheral module is missing — re-read what we actually got.
      return this.#advertisingNow() ? DISCOVERABILITY.PUBLISH : DISCOVERABILITY.BROWSE;
    }

    // Already running: move only the half that changed.
    if (wantScan && !this.#scanningNow()) this.#restartScan();

    if (wantAdvertise && !this.#advertisingNow()) {
      if (!BlePeripheral) {
        console.warn('[BleTransport] browse+publish requested but BlePeripheralModule is absent — browsing only.');
        this.#advertise = false;
      } else {
        await BlePeripheral.start(SERVICE_UUID, CHARACTERISTIC_UUID);
        this.#setupPeripheralEvents();
        this.#advertisingActive = true;
      }
    } else if (!wantAdvertise && this.#advertisingNow()) {
      // Stop announcing but KEEP scanning and keep existing GATT links — going quiet must not drop the
      // people you are already talking to.
      await BlePeripheral.stop().catch(() => {});
      this.#advertisingActive = false;
    }

    return this.#advertisingNow() ? DISCOVERABILITY.PUBLISH : DISCOVERABILITY.BROWSE;
  }

  #advertisingNow() { return this.#started && this.#advertise && !!BlePeripheral && this.#advertisingActive; }
  #scanningNow()    { return this.#started && this.#scan; }

  _hasPeer(pubKey) {
    return this.#centralPeers.has(pubKey) || this.#peripheralByPubKey.has(pubKey);
  }

  /**
   * Routing hint (Group EE).  A peer is reachable over BLE iff we have
   * an active GATT connection in either direction — OR the peerId looks
   * like a raw BLE MAC (contains ':') in which case we're in the
   * "initial hello to a freshly-scanned device" bootstrap path and need
   * BLE to claim it so the call triggers a connect.
   *
   * Note: this does NOT distinguish "fresh" from "silently-stale"
   * handles — if you need staleness-based eviction, do it on write
   * failure via RoutingStrategy.onTransportFailure, not here.
   */
  canReach(pubKey) {
    if (this._hasPeer(pubKey)) return true;
    if (typeof pubKey === 'string' && pubKey.includes(':')) return true;
    return false;
  }

  /**
   * Drop cached entries for a peer and kick the scanner so it can re-discover
   * the device. Without the scan restart the BleManager's de-dup filter keeps
   * the device in a "recently seen" state and suppresses a fresh report.
   */
  forgetPeer(pubKey) {
    const central = this.#centralPeers.get(pubKey);
    if (central) {
      this.#centralPeers.delete(pubKey);
      this.#writeQueues.delete(pubKey);
      central.device?.cancelConnection().catch(() => {});
    }
    const peripheral = this.#peripheralByPubKey.get(pubKey);
    if (peripheral) {
      this.#peripheralByPubKey.delete(pubKey);
      this.#peripheralByAddress.delete(peripheral.deviceAddress);
    }
    // Drop any buffered messages for this peer too — a forget is a hard
    // reset and we should not surprise the app by later delivering a
    // message it tried to cancel.
    this.#pendingForPeer.delete(pubKey);
    if (this.#scan && this.#started) this.#restartScan();
  }

  /** Manually re-run the BLE scan (public helper for a "refresh" button). */
  rescan() {
    if (this.#scan && this.#started) this.#restartScan();
  }

  #startScan() {
    this.#manager.startDeviceScan(
      [SERVICE_UUID],
      { allowDuplicates: true },  // allow re-reports so disconnected peers are found again
      (err, device) => {
        if (err) { this.emit('error', err); return; }
        if (device) this.#onCentralDevice(device).catch(() => {});
      },
    );
  }

  #restartScan() {
    try { this.#manager.stopDeviceScan(); } catch {}
    this.#startScan();
  }

  async _put(to, envelope) {
    const payload = JSON.stringify(envelope);

    // If we have no connection to `to` right now, queue for later delivery
    // instead of throwing. The buffer is capped by #bufferMaxPerPeer and TTL
    // (see _drainBuffer + forgetPeer). See Group V.
    if (!this.#centralPeers.has(to) && !this.#peripheralByPubKey.has(to)) {
      const queue = this.#pendingForPeer.get(to) ?? [];
      queue.push({ payload, enqueuedAt: Date.now() });
      while (queue.length > this.#bufferMaxPerPeer) queue.shift();  // drop oldest
      this.#pendingForPeer.set(to, queue);
      this.emit('buffered', { to, queueSize: queue.length });
      return;
    }

    // Serialize writes per peer: one GATT operation at a time.
    const prev = this.#writeQueues.get(to) ?? Promise.resolve();
    const next = prev.then(() => this._doWrite(to, payload));
    this.#writeQueues.set(to, next.catch(() => {}));
    return next;
  }

  /**
   * Drain pending messages for `pubKey` through the normal write path, FIFO,
   * after dropping anything past `#bufferTtlMs`.  Called by the central and
   * peripheral re-key paths when a peer becomes addressable by pubKey.
   */
  async _drainBuffer(pubKey) {
    const queue = this.#pendingForPeer.get(pubKey);
    if (!queue || queue.length === 0) return;
    this.#pendingForPeer.delete(pubKey);

    const cutoff = Date.now() - this.#bufferTtlMs;
    const fresh  = queue.filter(item => item.enqueuedAt >= cutoff);

    for (const item of fresh) {
      // Reuse the existing write-queue mutex so a drain-in-flight doesn't
      // collide with a new _put() in the same microtask.
      const prev = this.#writeQueues.get(pubKey) ?? Promise.resolve();
      const next = prev.then(() => this._doWrite(pubKey, item.payload));
      this.#writeQueues.set(pubKey, next.catch(() => {}));
      try { await next; } catch { /* drain continues for remaining items */ }
    }
  }

  async _doWrite(to, payload) {
    const central = this.#centralPeers.get(to);
    if (central) {
      const chunks = _chunk(payload, central.mtu - 3);
      try {
        for (const chunk of chunks) {
          // writeWithoutResponse uses LE link-layer credits (handled in the
          // Bluetooth controller) and does NOT occupy the BluetoothGatt
          // "one pending GATT command at a time" slot.  That slot is
          // needed by the CCCD descriptor write that `char.monitor()`
          // fires during central setup — using writeWithResponse here
          // would deadlock with it and surface as "Operation was rejected"
          // / "prior command is not finished" on Android.
          //
          // Reliability is covered at the application layer (RQ/RS
          // timeouts via Task.done()); we don't need per-chunk GATT ACKs.
          try {
            await central.char.writeWithoutResponse(chunk);
          } catch (wErr) {
            // Some stacks (or certain characteristic configurations) may
            // only accept writeWithResponse.  Fall back once per chunk.
            if (/write\s*without/i.test(wErr?.message ?? '')) {
              await central.char.writeWithResponse(chunk);
            } else {
              throw wErr;
            }
          }
        }
      } catch (err) {
        // Stale characteristic / disconnected device — drop the entry so we
        // don't keep failing on queued writes.  We also explicitly
        // cancelConnection so Android tears down the stale BluetoothGatt
        // context; merely deleting our map entry leaves the underlying
        // connection alive and the next scan would reuse the same
        // corrupted handle cache ("Characteristic 11 not found" → again).
        if (/characteristic|not connected|disconnected|not found/i.test(err?.message ?? '')) {
          this.#centralPeers.delete(to);
          this.#writeQueues.delete(to);
          central.device?.cancelConnection?.().catch(() => {});
          if (central.pubKey) this.emit('peer-disconnected', central.pubKey);
        }
        throw err;
      }
      return;
    }

    const peripheral = this.#peripheralByPubKey.get(to);
    if (peripheral) {
      const mtu    = peripheral.mtu ?? DEFAULT_MTU;
      const chunks = _chunk(payload, mtu - 3);
      for (const chunk of chunks) {
        await BlePeripheral.notify(peripheral.deviceAddress, CHARACTERISTIC_UUID, chunk);
      }
      return;
    }

    throw new Error(`BleTransport: not connected to ${to}`);
  }

  // ── Central mode: private ──────────────────────────────────────────────────

  /**
   * Connect + discover services/characteristics + requestMTU, retrying on
   * Android's stale-GATT-cache errors ("Characteristic N not found",
   * "Service N not found", etc.).
   *
   * Android's BLE stack caches each peer's service table per-device-MAC.
   * When the peer has been reset since our last connection (e.g. the app
   * restarted with fresh GATT registrations), the cached handles are
   * invalidated, but subsequent discovery calls still return the stale
   * table — later operations then fail resolving the (nonexistent)
   * numeric handle.  Android doesn't expose a public API to refresh the
   * cache, but disconnecting and waiting a few seconds causes the
   * framework to drop the stale entry.
   *
   * Strategy: on a "not found" error class, cancelConnection, sleep,
   * retry from a fresh connect() up to {RETRY_LIMIT} attempts.  Any
   * other error class bubbles out immediately.
   *
   * @returns {{connected, char, mtu} | null}  null if the peer doesn't
   *   expose our SERVICE_UUID / CHARACTERISTIC_UUID (wrong kind of peer).
   */
  async #connectWithStaleCacheRetry(device) {
    const RETRY_LIMIT = 3;
    const STALE_CACHE_PATTERN = /not found|not supported|characteristic|service/i;
    let lastErr;

    for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
      let connected;
      try {
        connected = await device.connect();
      } catch (err) {
        // Connect itself failed — don't retry indefinitely on genuine
        // connect errors (peer out of range, etc.).
        throw err;
      }

      try {
        const discovered = await connected.discoverAllServicesAndCharacteristics();
        const services   = await discovered.services();
        const svc        = services.find(s => s.uuid === SERVICE_UUID);
        if (!svc) {
          await connected.cancelConnection().catch(() => {});
          return null;
        }

        const chars = await svc.characteristics();
        const char  = chars.find(c => c.uuid === CHARACTERISTIC_UUID);
        if (!char) {
          await connected.cancelConnection().catch(() => {});
          return null;
        }

        const mtuDevice = await connected.requestMTU(512).catch(() => null);
        const mtu       = mtuDevice?.mtu ?? DEFAULT_MTU;

        // All checks passed.
        return { connected, char, mtu };
      } catch (err) {
        lastErr = err;
        await connected.cancelConnection().catch(() => {});

        // Only retry on the stale-cache signature; anything else
        // (connect-was-cancelled, device-out-of-range, etc.) bubbles.
        if (attempt < RETRY_LIMIT && STALE_CACHE_PATTERN.test(err?.message ?? '')) {
          // Android evicts the stale service-table entry after a few
          // seconds of idle; 3 s empirically covers Samsung + Pixel stacks.
          await new Promise(r => setTimeout(r, 3_000));
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error('BLE connect failed after retries');
  }

  async #onCentralDevice(device) {
    // Guard against duplicate connection attempts: check both the completed-peers
    // map and the in-progress set so a second scan result arriving during the
    // async connect steps doesn't start a second connection.
    if (this.#centralPeers.has(device.id))    return;
    if (this.#connectingDevices.has(device.id)) return;
    this.#connectingDevices.add(device.id);

    let connected, char, mtu;
    try {
      const result = await this.#connectWithStaleCacheRetry(device);
      if (!result) { this.#connectingDevices.delete(device.id); return; }
      ({ connected, char, mtu } = result);
    } catch (err) {
      this.#connectingDevices.delete(device.id);
      this.emit('error', err);
      return;
    } finally {
      this.#connectingDevices.delete(device.id);
    }

    const rxBuffer = { data: '', remaining: 0 };

    // pubKey starts null; filled in after first message arrives (re-keying below).
    this.#centralPeers.set(device.id, { device: connected, char, mtu, rxBuffer, pubKey: null });

    // Clean up when the peripheral disconnects — prevents stale characteristic
    // refs from being used in subsequent writes ("characteristic N not found").
    try {
      connected.onDisconnected((_err, _dev) => {
        for (const [key, peer] of this.#centralPeers) {
          if (peer.device === connected) {
            this.#centralPeers.delete(key);
            this.#writeQueues.delete(key);
            if (peer.pubKey) this.emit('peer-disconnected', peer.pubKey);
            break;
          }
        }
      });
    } catch { /* device already gone — the entry will be cleaned up by _doWrite */ }

    // Monitor notifications from this peripheral. Wrapped because calling
    // monitor() on a disconnected characteristic throws synchronously.
    try {
      char.monitor((err, c) => {
        if (err || !c?.value) return;
        this.#onCentralChunk(device.id, c.value);
      });
    } catch { /* same — cleanup happens on next write */ }

    // Emit device.id as a temporary address so the Agent sends a hello.
    // After the first reply arrives we re-emit with the real pubKey.
    this.emit('peer-discovered', device.id);
  }

  #onCentralChunk(deviceId, b64Value) {
    const peer = this.#centralPeers.get(deviceId);
    if (!peer) return;

    _reassemble(peer.rxBuffer, b64Value, raw => {
      let envelope;
      try { envelope = JSON.parse(raw); } catch { return; }

      // Re-key from BLE device ID to the peer's real pubKey on first complete message.
      if (!peer.pubKey) {
        const pubKey = envelope._from ?? envelope.from ?? envelope.payload?.from;
        if (pubKey && pubKey !== deviceId) {
          peer.pubKey = pubKey;
          this.#centralPeers.delete(deviceId);
          this.#centralPeers.set(pubKey, peer);
          this.emit('peer-discovered', pubKey);
          this._drainBuffer(pubKey).catch(() => {});
        }
      }

      try { this._receive(envelope); } catch {}
    });
  }

  // ── Peripheral mode: private ───────────────────────────────────────────────

  #setupPeripheralEvents() {
    this.#eventSubs.push(
      peripheralEmitter.addListener('BlePeripheralDeviceConnected', ({ address }) => {
        this.#peripheralByAddress.set(address, {
          deviceAddress: address,
          mtu:           DEFAULT_MTU,
          rxBuffer:      { data: '', remaining: 0 },
        });
      }),

      peripheralEmitter.addListener('BlePeripheralDeviceDisconnected', ({ address }) => {
        const state = this.#peripheralByAddress.get(address);
        this.#peripheralByAddress.delete(address);
        if (state?.pubKey) {
          this.#peripheralByPubKey.delete(state.pubKey);
          this.emit('peer-disconnected', state.pubKey);
        }
      }),

      peripheralEmitter.addListener('BlePeripheralMtuChanged', ({ address, mtu }) => {
        const state = this.#peripheralByAddress.get(address);
        if (state) state.mtu = mtu;
      }),

      peripheralEmitter.addListener('BlePeripheralWrite', ({ address, value }) => {
        const state = this.#peripheralByAddress.get(address);
        if (!state) return;

        _reassemble(state.rxBuffer, value, raw => {
          let envelope;
          try { envelope = JSON.parse(raw); } catch { return; }

          // Re-key from device address to pubKey on first complete message
          if (!state.pubKey) {
            const pubKey = envelope._from ?? envelope.from ?? envelope.payload?.from;
            if (pubKey) {
              state.pubKey = pubKey;
              this.#peripheralByPubKey.set(pubKey, state);
              this.emit('peer-discovered', pubKey);
              this._drainBuffer(pubKey).catch(() => {});
            }
          }

          try { this._receive(envelope); } catch {}
        });
      }),

      peripheralEmitter.addListener('BlePeripheralAdvertiseError', ({ message }) => {
        this.emit('error', new Error(`BLE advertise: ${message}`));
      }),
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Reassemble a length-prefixed BLE chunk stream. Calls onComplete(rawJson) once
// a full message has been accumulated across one or more GATT writes.
function _reassemble(buf, b64Value, onComplete) {
  const bytes = b64Decode(b64Value);

  if (buf.remaining === 0) {
    if (bytes.length < 4) return;
    buf.remaining = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    buf.data      = new TextDecoder().decode(bytes.slice(4));
    buf.remaining -= buf.data.length;
  } else {
    const str      = new TextDecoder().decode(bytes);
    buf.data      += str;
    buf.remaining -= str.length;
  }

  if (buf.remaining <= 0) {
    const raw     = buf.data;
    buf.data      = '';
    buf.remaining = 0;
    onComplete(raw);
  }
}

function _chunk(str, mtu) {
  const encoded = new TextEncoder().encode(str);
  const len     = encoded.length;

  const header = new Uint8Array(4);
  header[0] = (len >> 24) & 0xff;
  header[1] = (len >> 16) & 0xff;
  header[2] = (len >> 8)  & 0xff;
  header[3] =  len        & 0xff;

  const first = new Uint8Array(header.length + Math.min(mtu - 4, len));
  first.set(header);
  first.set(encoded.slice(0, mtu - 4), 4);

  const chunks = [b64Encode(first)];
  for (let i = mtu - 4; i < len; i += mtu) {
    chunks.push(b64Encode(encoded.slice(i, i + mtu)));
  }
  return chunks;
}
