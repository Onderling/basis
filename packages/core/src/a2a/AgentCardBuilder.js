/**
 * AgentCardBuilder — builds an A2A-compatible agent card JSON object.
 *
 * The card follows the A2A protocol spec shape:
 * {
 *   name, description, url, version,
 *   capabilities: { streaming, pushNotifications, stateTransitionHistory },
 *   defaultInputModes, defaultOutputModes,
 *   skills: [ SkillCard[] ],
 *   authentication: { schemes: ['Bearer'] },
 *   'x-canopy': { version, pubKey, relayUrl, groups, trustTiers }
 * }
 *
 * Skills are filtered by the requestTier (caller's trust level):
 *   0 = public, 1 = authenticated, 2 = trusted, 3 = private
 */

const VISIBILITY_TIER = { public: 0, authenticated: 1, trusted: 2, private: 3 };
const CARD_VERSION    = '1.0';

/**
 * Builds the A2A-compatible agent-card JSON for an agent, filtered by caller trust
 * tier: `build(requestTier)` lists only skills whose visibility tier is at or below
 * the request tier. Name/description/url/relay/groups come from the optional config;
 * the pubKey and skill list come from the agent itself.
 */
export class AgentCardBuilder {
  #agent;
  #config;    // optional AgentConfig

  /**
   * @param {object} opts
   * @param {import('../Agent.js').Agent} opts.agent
   * @param {object} [opts.config]  — optional AgentConfig for description/url/groups
   */
  constructor({ agent, config = {} }) {
    this.#agent  = agent;
    this.#config = config;
  }

  /**
   * Build the agent card filtered to the given request tier.
   *
   * @param {0|1|2|3} [requestTier=0]
   * @returns {object} A2A agent card
   */
  build(requestTier = 0) {
    const agent  = this.#agent;
    const config = this.#config;

    // Skills visible at this tier.
    const skills = agent.skills.all()
      .filter(s => (VISIBILITY_TIER[s.visibility] ?? 1) <= requestTier)
      .map(s => this.#skillCard(s));

    // Build trust tier map: tier level → required auth scheme.
    const trustTiers = {};
    for (const [vis, level] of Object.entries(VISIBILITY_TIER)) {
      if (level > 0) trustTiers[level] = vis;
    }

    const extensionBlock = {
      version:    CARD_VERSION,
      pubKey:     agent.pubKey,
      relayUrl:   config.relayUrl   ?? null,
      groups:     config.groups     ?? [],
      trustTiers,
    };
    const card = {
      name:        config.name        ?? agent.label ?? 'Agent',
      description: config.description ?? '',
      url:         config.url         ?? null,
      version:     CARD_VERSION,
      capabilities: {
        streaming:               true,
        pushNotifications:       false,
        stateTransitionHistory:  false,
      },
      defaultInputModes:  ['text/plain', 'application/json'],
      defaultOutputModes: ['text/plain', 'application/json'],
      skills,
      authentication: {
        schemes: ['Bearer'],
      },
      // Naming migration 2026-07-28 — the extension block is written under BOTH keys for one window:
      // `x-onderling` is the name going forward; `x-canopy` keeps peers on older app versions (and the
      // public feedback repo) reading this card until they update. Readers here prefer x-onderling.
      'x-onderling': extensionBlock,
      'x-canopy':    extensionBlock,
    };

    // Remove null url to keep card clean.
    if (!card.url) delete card.url;

    return card;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  #skillCard(skill) {
    return {
      id:          skill.id,
      name:        skill.name        ?? skill.id,
      description: skill.description ?? '',
      tags:        skill.tags        ?? [],
      inputModes:  skill.inputModes  ?? ['text/plain'],
      outputModes: skill.outputModes ?? ['text/plain'],
      streaming:   typeof skill.handler?.[Symbol.asyncIterator] === 'function'
                   || !!skill.streaming,
    };
  }
}
