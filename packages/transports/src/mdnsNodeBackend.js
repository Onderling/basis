/**
 * mdnsNodeBackend — the Node half of `MdnsTransport`, so a laptop can take part in a nearby group.
 *
 * `MdnsTransport` (this package) is the routing layer: peer maps, the tiebreaker, the `_mdns_hello`
 * handshake, discoverability. It asks a backend for sockets and service records. On Android that backend is
 * a Kotlin native module; this is the same contract implemented on `node:net`, so the rules that decide
 * whether two devices can see each other exist once and are not re-derived here.
 *
 * ── The framing is the interop surface, so it is written out rather than assumed ─────────────────────────
 * Every frame is a 4-byte BIG-ENDIAN length prefix followed by exactly that many bytes, matching
 * `MdnsModule.kt` (`DataInputStream.readFully`). TCP gives no message boundaries, so the read side buffers
 * and emits one `MdnsDataReceived` per complete frame — a peer that writes two messages in one packet, or
 * one message split across three, is indistinguishable to the layer above. Getting this wrong does not
 * error; it silently desynchronises the stream, which is why it has its own tests.
 *
 * Payloads cross the boundary as **standard base64 with padding** (`b64Encode`/`b64Decode` in this
 * package), because that is what the Kotlin backend emits and accepts. Not core's base64url.
 *
 * ── DNS-SD is injected, and deliberately not implemented here ────────────────────────────────────────────
 * Publishing and browsing `_onderling._tcp` is the one part that needs a multicast-DNS implementation, and
 * that is a dependency decision rather than a coding one. So it is a seam:
 *
 *   discovery.advertise({ serviceType, serviceName, port, txt }) -> Promise<() => void>
 *   discovery.browse({ serviceType, onFound, onLost })           -> Promise<() => void>
 *       onFound({ host, port, pubKey })   onLost?({ pubKey })
 *
 * Everything else — the listening socket, the outbound connections, the framing, the lifecycle — works
 * without it, and `createLoopbackDiscovery()` below lets the whole path be exercised over real sockets
 * with no library and no LAN.
 */
import net from 'node:net';
import { b64Encode, b64Decode } from './utils/base64.js';

/** Minimal `addListener` -> `{remove}` emitter, the shape `MdnsTransport` expects of a backend. */
function createEmitter() {
  const listeners = new Map();   // event -> Set<fn>
  return {
    addListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return { remove: () => listeners.get(event)?.delete(fn) };
    },
    emit(event, payload) {
      for (const fn of listeners.get(event) ?? []) {
        try { fn(payload); } catch { /* one bad listener must not stop the rest */ }
      }
    },
  };
}

/**
 * Read side of the length-prefixed stream. Returns a `push(chunk)` that yields whole frames.
 * Kept separate from the socket so it can be tested against adversarial chunkings directly.
 */
export function createFrameReader(onFrame) {
  let buf = Buffer.alloc(0);
  return function push(chunk) {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    // A loop, not an `if`: one TCP read can carry several complete frames.
    for (;;) {
      if (buf.length < 4) return;
      const len = buf.readUInt32BE(0);
      if (buf.length < 4 + len) return;          // partial — wait for more
      const body = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      onFrame(Buffer.from(body));
    }
  };
}

/** Write side: one frame, length-prefixed. */
export function frameEncode(bytes) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([head, Buffer.from(bytes)]);
}

/**
 * A discovery seam for tests and single-host runs: every backend built from the same registry finds every
 * other one, over REAL sockets on localhost. It replaces multicast, not TCP — so framing, the tiebreaker,
 * the hello handshake and the peer maps are all genuinely exercised.
 */
export function createLoopbackDiscovery() {
  const published = new Set();   // { serviceType, serviceName, port, txt }
  const browsers  = new Set();   // { serviceType, onFound, onLost }

  const announceTo = (b) => {
    for (const p of published) if (p.serviceType === b.serviceType) {
      b.onFound({ host: '127.0.0.1', port: p.port, pubKey: p.txt?.pubKey });
    }
  };

  return {
    async advertise(record) {
      published.add(record);
      for (const b of browsers) if (b.serviceType === record.serviceType) {
        b.onFound({ host: '127.0.0.1', port: record.port, pubKey: record.txt?.pubKey });
      }
      return () => {
        published.delete(record);
        for (const b of browsers) if (b.serviceType === record.serviceType) {
          b.onLost?.({ pubKey: record.txt?.pubKey });
        }
      };
    },
    async browse(b) {
      browsers.add(b);
      announceTo(b);                  // whoever is already here
      return () => browsers.delete(b);
    },
  };
}

/**
 * Build the Node backend.
 *
 * @param {object} deps
 * @param {{advertise:Function, browse:Function}} deps.discovery  the DNS-SD seam (see the header)
 * @param {string} [deps.host]  interface to bind (default: all)
 * @returns {{native: object, emitter: object}}  pass straight into `new MdnsTransport({...})`
 */
export function createMdnsNodeBackend({ discovery, host = undefined } = {}) {
  if (!discovery || typeof discovery.advertise !== 'function' || typeof discovery.browse !== 'function') {
    throw new Error('createMdnsNodeBackend: a discovery seam with advertise() + browse() is required');
  }

  const emitter = createEmitter();
  const conns   = new Map();   // connectionId -> net.Socket
  let nextId    = 0;
  let server    = null;
  let listenPort = 0;
  let stopAdvertise = null;
  let stopBrowse    = null;

  const fail = (err) => emitter.emit('MdnsError', { message: err?.message ?? String(err) });

  /** Wire a socket into the frame reader + the connection map. Used for both directions. */
  function adopt(socket, connectionId) {
    conns.set(connectionId, socket);
    socket.on('data', createFrameReader((body) => {
      emitter.emit('MdnsDataReceived', { connectionId, data: b64Encode(body) });
    }));
    const drop = () => {
      if (!conns.delete(connectionId)) return;   // only announce the first close
      emitter.emit('MdnsClientDisconnected', { connectionId });
    };
    socket.on('close', drop);
    socket.on('error', (err) => { fail(err); drop(); });
    socket.setNoDelay?.(true);
  }

  async function ensureServer() {
    if (server) return listenPort;
    server = net.createServer((socket) => {
      const connectionId = `conn-${++nextId}`;
      adopt(socket, connectionId);
      // The router holds this as PENDING until a `_mdns_hello` frame names the peer — an inbound socket
      // says someone is there, never who.
      emitter.emit('MdnsClientConnected', { connectionId });
    });
    server.on('error', fail);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, () => { server.off('error', reject); resolve(); });
    });
    listenPort = server.address().port;
    return listenPort;
  }

  async function advertise(serviceType, serviceName, pubKey) {
    const port = await ensureServer();
    if (stopAdvertise) return port;              // idempotent, like the native module
    stopAdvertise = await discovery.advertise({
      serviceType, serviceName, port, txt: { pubKey },
    });
    return port;
  }

  async function browse(serviceType) {
    if (stopBrowse) return;
    stopBrowse = await discovery.browse({
      serviceType,
      onFound: ({ host: h, port: p, pubKey }) =>
        emitter.emit('MdnsServiceDiscovered', { host: h, port: p, pubKey }),
      // The router drops a peer when its SOCKET closes, so a lost service record needs no event of its
      // own; browsers that report one are simply ignored rather than second-guessing the socket.
      onLost: () => {},
    });
  }

  const native = {
    /** Advertise AND browse — the combined call, matching the native module's `start`. */
    async start(serviceType, serviceName, pubKey) {
      const port = await advertise(serviceType, serviceName, pubKey);
      await browse(serviceType);
      return port;
    },
    startAdvertising: (serviceType, serviceName, pubKey) => advertise(serviceType, serviceName, pubKey),
    startDiscovery:   (serviceType) => browse(serviceType),

    async stopAdvertising() {
      // Going unlisted must NOT drop the listening socket or open connections: it is about who can find
      // you, not who can reach you. That is what makes browse-only a usable resting state.
      try { await stopAdvertise?.(); } finally { stopAdvertise = null; }
    },
    async stopDiscovery() {
      try { await stopBrowse?.(); } finally { stopBrowse = null; }
    },

    async stop() {
      await native.stopAdvertising();
      await native.stopDiscovery();
      for (const socket of [...conns.values()]) socket.destroy();
      conns.clear();
      if (server) {
        await new Promise((resolve) => server.close(() => resolve()));
        server = null;
        listenPort = 0;
      }
    },

    async connect(h, p) {
      const connectionId = `conn-${++nextId}`;
      const socket = await new Promise((resolve, reject) => {
        const s = net.connect({ host: h, port: p }, () => { s.off('error', reject); resolve(s); });
        s.once('error', reject);
      });
      adopt(socket, connectionId);
      return connectionId;
    },

    async send(connectionId, base64) {
      const socket = conns.get(connectionId);
      if (!socket) throw new Error(`mdnsNodeBackend: no connection ${connectionId}`);
      await new Promise((resolve, reject) => {
        socket.write(frameEncode(b64Decode(base64)), (err) => (err ? reject(err) : resolve()));
      });
    },

    async close(connectionId) {
      conns.get(connectionId)?.destroy();
    },
  };

  return { native, emitter };
}
