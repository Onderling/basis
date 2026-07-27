package com.canopy.mdns

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.*
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * MdnsModule — Android NsdManager (mDNS/DNS-SD) + TCP transport, all in one native module.
 *
 * Exposes to JS:
 *   start(serviceType, serviceName, pubKey): Promise<port>
 *       — register mDNS service, start TCP server, start discovery.
 *   stop(): Promise
 *       — unregister, stop discovery, close all sockets.
 *   connect(host, port): Promise<connectionId>
 *       — open an outbound TCP connection; returns a connectionId string.
 *   send(connectionId, dataB64): Promise
 *       — write a length-prefixed frame (4-byte BE length + data).
 *   disconnect(connectionId): Promise
 *       — close a specific connection.
 *
 * JS events emitted:
 *   MdnsServiceRegistered   { name, port }     — mDNS registration confirmed
 *   MdnsServiceDiscovered   { name, host, port, pubKey } — peer resolved
 *   MdnsServiceLost         { name }            — peer disappeared
 *   MdnsClientConnected     { connectionId, remoteAddress }
 *   MdnsClientDisconnected  { connectionId }
 *   MdnsDataReceived        { connectionId, data: base64 } — complete frame received
 *   MdnsError               { message }
 *
 * Framing: each message is prefixed with a 4-byte big-endian length (DataOutputStream.writeInt /
 * DataInputStream.readFully). The JS side never needs to buffer or reassemble — each
 * MdnsDataReceived event carries exactly one complete message.
 *
 * Permissions required (already in AndroidManifest.xml):
 *   INTERNET, ACCESS_WIFI_STATE, CHANGE_WIFI_MULTICAST_STATE
 *
 * ── NsdManager quirk: serial resolves ────────────────────────────────────────
 * Android < 12 allows only one concurrent resolveService() call. If a second
 * resolve arrives while one is active it fails with FAILURE_ALREADY_ACTIVE (3).
 * We retry with exponential backoff (up to MAX_RESOLVE_RETRIES attempts).
 */
class MdnsModule(reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val MODULE_NAME = "MdnsModule"
    }

    override fun getName() = MODULE_NAME

    private val nsdManager by lazy {
        reactApplicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    }
    private val executor    = Executors.newCachedThreadPool()
    private val idCounter   = AtomicInteger(0)
    private val mainHandler = Handler(Looper.getMainLooper())

    // connectionId → ConnectionState
    private val connections          = ConcurrentHashMap<String, ConnectionState>()
    private var serverSocket         : ServerSocket? = null
    private var registrationListener : NsdManager.RegistrationListener? = null
    private var discoveryListener    : NsdManager.DiscoveryListener? = null
    @Volatile private var running    = false

    private data class ConnectionState(
        val id:     String,
        val socket: Socket,
        val out:    DataOutputStream,
    )

    // ── JS API ─────────────────────────────────────────────────────────────────

    /**
     * Announcing and browsing, in one call — the original API, kept so an older JS bundle keeps working.
     * Now expressed in terms of the two halves below rather than duplicating them.
     */
    @ReactMethod
    fun start(serviceType: String, serviceName: String, pubKey: String, promise: Promise) {
        executor.submit {
            try {
                val port = ensureAdvertising(serviceType, serviceName, pubKey)
                ensureDiscovery(serviceType)
                promise.resolve(port)
            } catch (e: Exception) {
                promise.reject("MDNS_START_FAILED", e.message, e)
            }
        }
    }

    // ── The split (Nearby step B) ──────────────────────────────────────────────
    //
    // `start()` did four things at once — TCP server, accept loop, NSD registration, NSD discovery — so
    // there was no way to watch the network without joining it. That made "ghost mode" impossible and made
    // the passive "N devices nearby" count cost you being counted back.
    //
    // The split is along ANNOUNCE vs LISTEN, and it deliberately leaves the DATA plane out of both:
    //
    //   • advertising  = the NSD service record (plus the listening socket it points at)
    //   • discovery    = the NSD browse
    //   • connections  = neither; they live until stop()
    //
    // That last line is the point. Advertising is how people FIND you, not how they REACH you. Unregistering
    // the record must not drop sockets that are already open, or "go unlisted" would silently mean
    // "disconnect from everyone you are talking to" — which is exactly why the JS layer could not previously
    // rest in a non-announcing state.

    /** Announce this device. Idempotent. @returns the TCP port being advertised. */
    @ReactMethod
    fun startAdvertising(serviceType: String, serviceName: String, pubKey: String, promise: Promise) {
        executor.submit {
            try {
                promise.resolve(ensureAdvertising(serviceType, serviceName, pubKey))
            } catch (e: Exception) {
                promise.reject("MDNS_ADVERTISE_FAILED", e.message, e)
            }
        }
    }

    /**
     * Stop announcing — ghost mode.
     *
     * Unregisters the service record ONLY. The listening socket and every open connection stay up: someone
     * who already found you can still reach you, and a peer you are mid-conversation with does not get
     * dropped because you stopped advertising. Re-advertising later reuses the same port.
     */
    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        try {
            registrationListener?.let { runCatching { nsdManager.unregisterService(it) } }
            registrationListener = null
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("MDNS_STOP_ADVERTISE_FAILED", e.message, e)
        }
    }

    /**
     * Browse for peers without announcing.
     *
     * Opens no listening socket: a device in ghost mode should not be accepting inbound connections either.
     * It reaches peers by connecting OUT, which `connect()` does independently — and because nobody can
     * discover it, the JS layer must always be the initiator (see MdnsTransport's tiebreaker).
     */
    @ReactMethod
    fun startDiscovery(serviceType: String, promise: Promise) {
        executor.submit {
            try {
                ensureDiscovery(serviceType)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("MDNS_DISCOVERY_FAILED", e.message, e)
            }
        }
    }

    /** Stop browsing. Leaves advertising and open connections alone. */
    @ReactMethod
    fun stopDiscovery(promise: Promise) {
        try {
            discoveryListener?.let { runCatching { nsdManager.stopServiceDiscovery(it) } }
            discoveryListener = null
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("MDNS_STOP_DISCOVERY_FAILED", e.message, e)
        }
    }

    // ── Internals shared by the halves ─────────────────────────────────────────

    /** Start (or reuse) the TCP server + accept loop. @returns the bound port. */
    private fun ensureServer(): Int {
        serverSocket?.let { if (!it.isClosed) return it.localPort }

        running = true
        val server = ServerSocket(0).also { serverSocket = it }
        executor.submit {
            while (running && !server.isClosed) {
                try {
                    val client = server.accept()
                    val id     = "in_${idCounter.incrementAndGet()}"
                    onNewSocket(id, client)
                } catch (_: Exception) {}
            }
        }
        return server.localPort
    }

    private fun ensureAdvertising(serviceType: String, serviceName: String, pubKey: String): Int {
        val port = ensureServer()
        if (registrationListener != null) return port   // already announced

        val info = NsdServiceInfo().apply {
            this.serviceName = serviceName
            this.serviceType = "$serviceType._tcp."
            this.port        = port
            setAttribute("pubKey", pubKey)
        }
        registrationListener = makeRegistrationListener(port)
        nsdManager.registerService(info, NsdManager.PROTOCOL_DNS_SD, registrationListener)
        return port
    }

    private fun ensureDiscovery(serviceType: String) {
        if (discoveryListener != null) return           // already browsing
        running = true
        discoveryListener = makeDiscoveryListener(serviceType)
        nsdManager.discoverServices(
            "$serviceType._tcp.", NsdManager.PROTOCOL_DNS_SD, discoveryListener
        )
    }

    @ReactMethod
    fun stop(promise: Promise) {
        running = false
        try {
            registrationListener?.let { runCatching { nsdManager.unregisterService(it) } }
            discoveryListener?.let    { runCatching { nsdManager.stopServiceDiscovery(it) } }
            registrationListener = null
            discoveryListener    = null
            serverSocket?.close();  serverSocket = null
            for ((id, state) in connections) {
                state.socket.close()
                emitDisconnected(id)
            }
            connections.clear()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("MDNS_STOP_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun connect(host: String, port: Int, promise: Promise) {
        executor.submit {
            try {
                val socket = Socket(host, port)
                val id     = "out_${idCounter.incrementAndGet()}"
                onNewSocket(id, socket)
                promise.resolve(id)
            } catch (e: Exception) {
                promise.reject("MDNS_CONNECT_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun send(connectionId: String, dataB64: String, promise: Promise) {
        val state = connections[connectionId]
            ?: return promise.reject("MDNS_NOT_CONNECTED", "No connection: $connectionId")
        executor.submit {
            try {
                val data  = Base64.decode(dataB64, Base64.NO_WRAP)
                val frame = MdnsFraming.encode(data)
                synchronized(state.out) {
                    state.out.write(frame)
                    state.out.flush()
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("MDNS_SEND_FAILED", e.message, e)
                connections.remove(connectionId)
                state.socket.close()
                emitDisconnected(connectionId)
            }
        }
    }

    @ReactMethod
    fun disconnect(connectionId: String, promise: Promise) {
        connections.remove(connectionId)?.socket?.close()
        promise.resolve(null)
    }

    // Required boilerplate for React Native NativeEventEmitter
    @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {}
    @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Int) {}

    // ── Internal ───────────────────────────────────────────────────────────────

    private fun onNewSocket(id: String, socket: Socket) {
        val out   = DataOutputStream(BufferedOutputStream(socket.getOutputStream()))
        val state = ConnectionState(id, socket, out)
        connections[id] = state

        emit("MdnsClientConnected", Arguments.createMap().also {
            it.putString("connectionId",   id)
            it.putString("remoteAddress",  socket.inetAddress.hostAddress)
        })

        // Read loop — one complete message per MdnsDataReceived event
        executor.submit {
            val inp = DataInputStream(BufferedInputStream(socket.getInputStream()))
            try {
                while (!socket.isClosed) {
                    val len = inp.readInt()
                    if (len <= 0 || len > MdnsFraming.MAX_PAYLOAD) break
                    val buf = ByteArray(len)
                    inp.readFully(buf)
                    emit("MdnsDataReceived", Arguments.createMap().also {
                        it.putString("connectionId", id)
                        it.putString("data", Base64.encodeToString(buf, Base64.NO_WRAP))
                    })
                }
            } catch (_: Exception) {}
            finally {
                connections.remove(id)
                runCatching { socket.close() }
                emitDisconnected(id)
            }
        }
    }

    private fun makeRegistrationListener(port: Int) = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(info: NsdServiceInfo) {
            emit("MdnsServiceRegistered", Arguments.createMap().also {
                it.putString("name", info.serviceName)
                it.putInt("port",    port)
            })
        }
        override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
            emitError("mDNS registration failed (errorCode=$errorCode)")
        }
        override fun onServiceUnregistered(info: NsdServiceInfo) {}
        override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {}
    }

    private fun makeDiscoveryListener(serviceType: String) = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(type: String)  {}
        override fun onDiscoveryStopped(type: String)  {}
        override fun onStartDiscoveryFailed(type: String, errorCode: Int) {
            emitError("mDNS discovery start failed (errorCode=$errorCode)")
        }
        override fun onStopDiscoveryFailed(type: String, errorCode: Int) {}

        override fun onServiceFound(info: NsdServiceInfo) {
            resolveWithRetry(info, 0)
        }

        override fun onServiceLost(info: NsdServiceInfo) {
            emit("MdnsServiceLost", Arguments.createMap().also {
                it.putString("name", info.serviceName)
            })
        }
    }

    private fun resolveWithRetry(info: NsdServiceInfo, attempt: Int) {
        nsdManager.resolveService(info, object : NsdManager.ResolveListener {
            override fun onServiceResolved(resolved: NsdServiceInfo) {
                val host   = resolved.host?.hostAddress ?: return
                val pubKey = resolved.attributes["pubKey"]?.let { String(it) } ?: return
                emit("MdnsServiceDiscovered", Arguments.createMap().also {
                    it.putString("name",   resolved.serviceName)
                    it.putString("host",   host)
                    it.putInt("port",      resolved.port)
                    it.putString("pubKey", pubKey)
                })
            }
            override fun onResolveFailed(failedInfo: NsdServiceInfo, errorCode: Int) {
                // FAILURE_ALREADY_ACTIVE (3): another resolve is in progress — retry with backoff.
                if (attempt < BackoffPolicy.MAX_RETRIES) {
                    val delay = BackoffPolicy.delayMs(attempt)
                    mainHandler.postDelayed({ resolveWithRetry(failedInfo, attempt + 1) }, delay)
                } else {
                    emitError("mDNS resolve failed after ${BackoffPolicy.MAX_RETRIES} attempts (errorCode=$errorCode)")
                }
            }
        })
    }

    private fun emitDisconnected(id: String) =
        emit("MdnsClientDisconnected", Arguments.createMap().also { it.putString("connectionId", id) })

    private fun emitError(message: String) =
        emit("MdnsError", Arguments.createMap().also { it.putString("message", message) })

    private fun emit(event: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, params)
    }
}
