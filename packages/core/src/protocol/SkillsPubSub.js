/**
 * SkillsPubSub — pattern-aware pubsub layer for skill advertisements.
 *
 * Sits on top of `pubSub.js` (which is exact-match only) and adds a
 * per-segment `*` wildcard convention.  D2 of Track-D (multi-member
 * infrastructure).
 *
 * Topic format (locked, see Q-D.4):
 *   skills:<group-id>:<posture>:<audience>:<skill-id>
 *
 *   <group-id>  group id, or 'none' if ungrouped
 *   <posture>   'always' | 'negotiable'    (from D1 / defineSkill.js)
 *   <audience>  'machine' | 'human' | 'either'
 *               derived from D1's `humanInTheLoop`:
 *                 'never'    → 'machine'
 *                 'required' → 'human'
 *                 'either'   → 'either'
 *   <skill-id>  the skill id
 *
 * Broadcaster emits ONE message per skill (no fan-out).  Subscribers wanting
 * humans-only OR machines-only register two patterns each (their preferred
 * audience PLUS `either`) so a single broadcast on the `either` audience
 * reaches both buckets.
 *
 * The native `pubSub.js` does NOT support wildcards — D2 keeps its own
 * `Map<patternRegex, Set<handler>>` and intercepts the `'publish'` events
 * the agent already emits when it receives a publish OW.  Broadcasts go
 * through `publish(agent, topic, payload)` unchanged.
 */
import { subscribe as pubsubSubscribe, publish as pubsubPublish } from './pubSub.js';
import { parseUntrustedJson } from '../security/untrustedJson.js';

/**
 * Translate D1's `humanInTheLoop` into the on-the-wire audience segment.
 *
 * @param {'never'|'either'|'required'|undefined} hitl
 * @returns {'machine'|'human'|'either'}
 */
export function audienceFromHumanInTheLoop(hitl) {
  switch (hitl) {
    case 'never':    return 'machine';
    case 'required': return 'human';
    case 'either':   return 'either';
    default:         return 'machine'; // backward compat for skills with no hitl
  }
}

const TOPIC_PREFIX = 'skills';

/**
 * Build the 5-segment skill topic.
 *
 * @param {object} opts
 * @param {string} [opts.group='none']
 * @param {'always'|'negotiable'} opts.posture
 * @param {'machine'|'human'|'either'} opts.audience
 * @param {string} opts.skillId
 */
export function buildTopic({ group = 'none', posture, audience, skillId }) {
  return `${TOPIC_PREFIX}:${group}:${posture}:${audience}:${skillId}`;
}

/**
 * Compile a pattern (5-segment string with `*` wildcards) into a regex
 * that matches a topic.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
function compilePattern(pattern) {
  const parts = pattern.split(':');
  if (parts.length !== 5) {
    throw new Error(
      `SkillsPubSub: pattern must have 5 segments, got "${pattern}"`,
    );
  }
  const escaped = parts.map(seg => {
    if (seg === '*') return '[^:]+';
    // Escape regex metacharacters in literal segments.
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp(`^${escaped.join(':')}$`);
}

/**
 * Translate a filter into one or more wildcard patterns.
 *
 * @param {object} [filter]
 * @param {string}                   [filter.skill]
 * @param {'always'|'negotiable'}    [filter.posture]
 * @param {'machine'|'human'|'either-only'|'any'} [filter.audience]
 * @param {string}                   [filter.group]
 * @returns {string[]} list of pattern strings (5-segment with `*`)
 */
function patternsForFilter({ skill, posture, audience, group } = {}) {
  const groupSeg   = group   ?? '*';
  const postureSeg = posture ?? '*';
  const skillSeg   = skill   ?? '*';

  /** @type {string[]} */
  let audienceSegs;
  switch (audience) {
    case 'human':       audienceSegs = ['human',   'either']; break;
    case 'machine':     audienceSegs = ['machine', 'either']; break;
    case 'either-only': audienceSegs = ['either'];            break;
    case 'any':
    case undefined:
    case null:          audienceSegs = ['*'];                 break;
    default:
      throw new Error(`SkillsPubSub: unknown audience filter "${audience}"`);
  }

  return audienceSegs.map(a =>
    `${TOPIC_PREFIX}:${groupSeg}:${postureSeg}:${a}:${skillSeg}`,
  );
}

/**
 * Pattern-aware skill advertisement layer.
 *
 * Construct one per agent.  Broadcasts go through the underlying pubSub;
 * subscriptions register pattern listeners that fire on incoming `publish`
 * events.
 */
export class SkillsPubSub {
  #agent;
  #skillRegistry;

  /** @type {Map<string, { regex: RegExp, handlers: Set<Function> }>} */
  #patterns = new Map();

  /** @type {Function|null} */
  #publishListener = null;

  /** @type {Map<string, Function>} */
  #pubsubSubscriptions = new Map(); // publisherAddress → listener bound on agent

  /**
   * @param {object} opts
   * @param {import('../Agent.js').Agent} opts.agent
   * @param {import('../skills/SkillRegistry.js').SkillRegistry} [opts.skillRegistry]
   */
  constructor({ agent, skillRegistry } = {}) {
    if (!agent) throw new Error('SkillsPubSub: { agent } is required');
    this.#agent = agent;
    this.#skillRegistry = skillRegistry ?? agent.skills;
    if (!this.#skillRegistry) {
      throw new Error(
        'SkillsPubSub: agent has no SkillRegistry and none supplied',
      );
    }
  }

  /** @returns {import('../Agent.js').Agent} */
  get agent() { return this.#agent; }

  /** @returns {import('../skills/SkillRegistry.js').SkillRegistry} */
  get skillRegistry() { return this.#skillRegistry; }

  /**
   * Build the topic for a given skill.
   *
   * @param {string} skillId
   * @param {{ group?: string }} [opts]
   * @returns {string}
   */
  topicFor(skillId, opts = {}) {
    const skill = this.#skillRegistry.get(skillId);
    if (!skill) {
      throw new Error(`SkillsPubSub.topicFor: skill "${skillId}" not registered`);
    }
    return buildTopic({
      group:    opts.group ?? 'none',
      posture:  skill.posture,
      audience: audienceFromHumanInTheLoop(skill.humanInTheLoop),
      skillId:  skill.id,
    });
  }

  /**
   * Broadcast a single skill on the matching topic.  Looks up the skill in
   * the local SkillRegistry and derives the topic from its posture +
   * humanInTheLoop.
   *
   * @param {string} skillId
   * @param {object} [opts]
   * @param {string} [opts.group='none']     — group id or 'none'
   * @param {number} [opts.expiresAt]        — defaults to now + 60s
   * @param {object} [opts.extra]            — extra payload fields (merged in)
   * @returns {Promise<{ topic: string, payload: object }>}
   */
  async broadcastSkill(skillId, opts = {}) {
    const skill = this.#skillRegistry.get(skillId);
    if (!skill) {
      throw new Error(`SkillsPubSub.broadcastSkill: skill "${skillId}" not registered`);
    }

    const group    = opts.group ?? 'none';
    const posture  = skill.posture;
    const audience = audienceFromHumanInTheLoop(skill.humanInTheLoop);
    const topic    = buildTopic({ group, posture, audience, skillId: skill.id });

    const payload = {
      skillId:        skill.id,
      agentId:        this.#agent.identity?.pubKey ?? this.#agent.pubKey ?? null,
      posture,
      humanInTheLoop: skill.humanInTheLoop,
      capabilities:   skill.tags ?? [],
      expiresAt:      opts.expiresAt ?? Date.now() + 60_000,
      ...(opts.extra ?? {}),
    };

    await pubsubPublish(this.#agent, topic, payload);
    return { topic, payload };
  }

  /**
   * Broadcast every enabled skill in the registry that matches an optional
   * filter (delegates to `SkillRegistry.getByPosture`).  Useful for the
   * initial advertisement burst when an agent comes online.
   *
   * @param {object} [opts]
   * @param {{ posture?: string, humanInTheLoop?: string }} [opts.filter]
   * @param {string} [opts.group='none']
   */
  async broadcastAll(opts = {}) {
    const skills = this.#skillRegistry.getByPosture
      ? this.#skillRegistry.getByPosture(opts.filter ?? {})
      : this.#skillRegistry.all().filter(s => {
          const f = opts.filter ?? {};
          if (f.posture        && s.posture        !== f.posture)        return false;
          if (f.humanInTheLoop && s.humanInTheLoop !== f.humanInTheLoop) return false;
          return true;
        });

    const out = [];
    for (const s of skills) {
      if (s.enabled === false) continue;
      out.push(await this.broadcastSkill(s.id, { group: opts.group }));
    }
    return out;
  }

  /**
   * Subscribe to skill broadcasts matching a filter.
   *
   * Filter translation:
   *   audience: 'human'       → patterns `*:*:human:*` AND `*:*:either:*`
   *   audience: 'machine'     → patterns `*:*:machine:*` AND `*:*:either:*`
   *   audience: 'either-only' → pattern  `*:*:either:*`
   *   audience: 'any' / unset → pattern  `*:*:*:*`
   * Other unset filter fields collapse to `*` for that segment.
   *
   * @param {object}   [filter]
   * @param {string}   [filter.skill]
   * @param {'always'|'negotiable'} [filter.posture]
   * @param {'machine'|'human'|'either-only'|'any'} [filter.audience]
   * @param {string}   [filter.group]
   * @param {Function} handler — called with ({ topic, payload, from })
   * @returns {() => void} unsubscribe
   */
  subscribeToSkills(filter = {}, handler) {
    if (typeof handler !== 'function') {
      throw new Error('SkillsPubSub.subscribeToSkills: handler must be a function');
    }

    this.#ensurePublishListener();

    const patternStrings = patternsForFilter(filter);
    const registered = [];

    for (const ps of patternStrings) {
      let entry = this.#patterns.get(ps);
      if (!entry) {
        entry = { regex: compilePattern(ps), handlers: new Set() };
        this.#patterns.set(ps, entry);
      }
      entry.handlers.add(handler);
      registered.push(ps);
    }

    return () => {
      for (const ps of registered) {
        const entry = this.#patterns.get(ps);
        if (!entry) continue;
        entry.handlers.delete(handler);
        if (entry.handlers.size === 0) this.#patterns.delete(ps);
      }
    };
  }

  /**
   * Ensure we have an underlying pubSub subscription on `publisherAddress`
   * so its publishes flow into our agent.  Wraps `pubSub.subscribe()` —
   * but the topic is exact-match, so we subscribe with the most permissive
   * "match anything" topic that pubSub.js will let us register: we pass a
   * unique topic per pattern and the handler is a noop (the real fanout is
   * via the `'publish'` event we listen for).
   *
   * In practice, subscribers are expected to subscribe to a publisher with
   * a known topic via the existing `subscribe(...)` API, OR the agents
   * already share publish events through the `'publish'` event hook in
   * `pubSub.handlePubSub`.  This helper exists for the explicit case.
   *
   * @param {string} publisherAddress
   * @param {string} topic              — concrete topic to subscribe to (no wildcards on the wire)
   */
  async followPublisher(publisherAddress, topic) {
    await pubsubSubscribe(this.#agent, publisherAddress, topic, () => {});
  }

  /**
   * Opt-in helper that re-broadcasts every enabled skill on a fixed
   * interval.  Useful while the SkillRegistry mutation hooks aren't wired
   * yet.  Returns a `stop()` function.
   *
   * @param {object} [opts]
   * @param {number} [opts.intervalMs=30000]
   * @param {string} [opts.group='none']
   * @param {{ posture?: string, humanInTheLoop?: string }} [opts.filter]
   * @returns {() => void} stop
   */
  republishOnSkillChange(opts = {}) {
    const interval = opts.intervalMs ?? 30_000;
    let stopped    = false;

    const tick = async () => {
      if (stopped) return;
      try {
        await this.broadcastAll({ group: opts.group, filter: opts.filter });
      } catch (err) {
        this.#agent.emit?.('error', err);
      }
    };

    const handle = setInterval(tick, interval);
    // Fire once immediately so subscribers get the current state.
    tick();

    return () => {
      stopped = true;
      clearInterval(handle);
    };
  }

  /**
   * Tear down the agent-level `'publish'` event listener and clear all
   * registered patterns.  Idempotent.
   */
  destroy() {
    if (this.#publishListener) {
      this.#agent.off?.('publish', this.#publishListener);
      this.#publishListener = null;
    }
    this.#patterns.clear();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #ensurePublishListener() {
    if (this.#publishListener) return;
    this.#publishListener = ({ from, topic, parts }) => {
      // Only consider topics that look like skill advertisements.
      if (typeof topic !== 'string' || !topic.startsWith(`${TOPIC_PREFIX}:`)) return;

      const payload = _extractPayload(parts);

      for (const { regex, handlers } of this.#patterns.values()) {
        if (!regex.test(topic)) continue;
        for (const h of handlers) {
          try {
            h({ topic, payload, from });
          } catch (err) {
            this.#agent.emit?.('error', err);
          }
        }
      }
    };
    this.#agent.on('publish', this.#publishListener);
  }
}

/**
 * Extract the original JSON payload from the parts array we receive on
 * `'publish'`.  `pubSub.publish()` calls `Parts.wrap(payload)`, which for an
 * object returns a single DataPart whose `data` is the original object.
 */
function _extractPayload(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const p = parts[0];
  if (p == null) return null;
  if (p.type === 'DataPart' && p.data !== undefined) return p.data;
  if (p.type === 'TextPart' && typeof p.text === 'string') {
    try { return parseUntrustedJson(p.text); } catch { return p.text; }
  }
  return p;
}
