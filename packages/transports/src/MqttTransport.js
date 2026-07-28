/**
 * MqttTransport — MQTT broker transport.
 *
 * Each agent subscribes to its own inbox topic:
 *   onderling/<address>/in
 *
 * Outbound messages are published to the recipient's inbox:
 *   onderling/<to>/in
 *
 * The address is a 24-char lowercase hex string derived from the first 12
 * bytes of the agent's Ed25519 pubKey. Short enough to be human-readable,
 * long enough to be collision-resistant.
 *
 * Requires the `mqtt` npm package (peer dependency).
 *
 * Usage:
 *   const t = new MqttTransport({
 *     brokerUrl: 'wss://broker.hivemq.com:8884/mqtt',
 *     identity,
 *   });
 *   await t.connect();
 */
import { Transport } from '@onderling/core';

const PREFIX = 'onderling';

/**
 * MQTT-broker `Transport`: the agent subscribes to its own inbox topic `onderling/<address>/in` and
 * publishes outbound envelopes to `onderling/<to>/in`. The address is 24 lowercase hex chars derived
 * from the first 12 bytes of the identity's Ed25519 pubKey. Requires the `mqtt` package (peer
 * dependency), dynamic-imported on `connect()`.
 */
export class MqttTransport extends Transport {
  #client  = null;
  #opts;

  /**
   * @param {object} opts
   * @param {string}  opts.brokerUrl
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   * @param {object}  [opts.mqttOpts]  — forwarded to mqtt.connect()
   */
  constructor(opts) {
    if (!opts?.brokerUrl) throw new Error('MqttTransport requires brokerUrl');
    const addr = MqttTransport.deriveAddress(opts.identity);
    super({ address: addr, identity: opts.identity });
    this.#opts = opts;
  }

  async connect() {
    let mqtt;
    try {
      const mod = await import('mqtt');
      mqtt = mod.default ?? mod;
    } catch {
      throw new Error('mqtt package not found. Run: npm install mqtt');
    }

    await new Promise((resolve, reject) => {
      this.#client = mqtt.connect(this.#opts.brokerUrl, {
        clientId: `onderling_${this.address}`,
        clean:    true,
        ...this.#opts.mqttOpts,
      });

      this.#client.once('connect', () => {
        this.#client.subscribe(`${PREFIX}/${this.address}/in`, err => {
          if (err) { reject(err); return; }
          this.emit('connect', { address: this.address });
          resolve();
        });
      });

      this.#client.on('message', (_topic, payload) => {
        let envelope;
        try { envelope = JSON.parse(payload.toString()); } catch { return; }
        this._receive(envelope);
      });

      this.#client.on('error', err => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        reject(err);
      });
    });
  }

  async disconnect() {
    await new Promise(res => this.#client?.end(false, {}, res));
    this.#client = null;
    this.emit('disconnect');
  }

  async _put(to, envelope) {
    if (!this.#client) throw new Error('MqttTransport: not connected');
    const topic   = `${PREFIX}/${to}/in`;
    const payload = JSON.stringify(envelope);
    await new Promise((resolve, reject) => {
      this.#client.publish(topic, payload, { qos: 1 }, err => err ? reject(err) : resolve());
    });
  }

  // ── Static helpers ─────────────────────────────────────────────────────────

  /** Derive a 24-char hex address from the first 12 bytes of pubKey. */
  static deriveAddress(identity) {
    if (!identity) throw new Error('MqttTransport.deriveAddress requires identity');
    const bytes = identity.pubKeyBytes.subarray(0, 12);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
