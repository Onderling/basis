/**
 * Core types for @onderling-app/household.  jsdoc only (per CLAUDE.md
 * — no TypeScript).  Importing this module gives you nothing at
 * runtime; the `@typedef`s here are for the IDE + jsdoc tooling.
 *
 * Single source of truth for shapes that span modules.  Extending a
 * type that's already in use means a schema-version bump + migration
 * plan — see programming-plan.md.
 */

/**
 * @typedef {'shopping' | 'errand' | 'repair' | 'schedule'} ItemType
 */

/**
 * A "thing the household cares about", living on a pod.  Same shape
 * regardless of which pod (household / member) holds it.
 *
 * This IS the shared/rich task shape (`@onderling/item-types` `task`):
 * the owner is `assignee` (singular mirror of the `assignees[]` co-owner
 * set on the substrate), and `completedAt` is ABSENT while the item is
 * open — not an explicit `null`.  Household stores its own non-canonical
 * types (shopping/errand/repair/schedule/contact) in this same shape, so
 * there is one task shape across the app, not a lightweight variant.
 *
 * @typedef {object} Item
 * @property {string}      id                ULID
 * @property {ItemType}    type
 * @property {string}      text              freeform user-supplied text
 * @property {string}      addedBy           webid
 * @property {number}      addedAt           ms epoch
 * @property {string}     [assignee]         webid of the owner; absent = unclaimed
 * @property {number}     [completedAt]      ms epoch; absent while open
 * @property {Source}      source            origin marker (e.g. tg chat+message)
 * @property {number}     [dueAt]            optional ms epoch
 */

/**
 * @typedef {{ tg: { chatId: string, messageId: string } }} Source
 */

/**
 * One incoming message on any messaging platform.  The
 * `MessagingBridge` adapter is responsible for normalising the
 * platform's wire format to this shape.
 *
 * @typedef {object} IncomingMessage
 * @property {string}      bridgeId         'telegram' | 'signal' | 'matrix' | 'mock' | …
 * @property {string}      chatId           platform-scoped opaque id
 * @property {string}      messageId        platform-scoped message id
 * @property {Sender}      sender
 * @property {string}      text
 * @property {string|null} replyTo          message-id this is a reply to, if any
 * @property {boolean}     isAddressed      true if @-mentioned / DM / reply-to-bot
 */

/**
 * @typedef {object} Sender
 * @property {string}      displayName
 * @property {string}      bridgeUid        platform-scoped user id
 * @property {string|null} webid            resolved webid if mapping exists
 */

/**
 * What a skill returns.  Any inline button presses come back as a
 * separate `IncomingMessage` (the bridge synthesises one).
 *
 * @typedef {object} Reply
 * @property {Array<ReplyMessage>} replies
 * @property {Array<StateUpdate>}  stateUpdates
 */

/**
 * @typedef {object} ReplyMessage
 * @property {string}         text
 * @property {Array<Button>} [buttons]
 */

/**
 * @typedef {{ id: string, label: string }} Button
 */

/**
 * Emitted by skills so the agent can react (start a nudge timer,
 * cancel one, push a notification, etc.).  Phase 4 consumes these.
 *
 * @typedef {object} StateUpdate
 * @property {'item.added'|'item.completed'|'item.removed'} kind
 * @property {string} itemId
 * @property {string} chatId
 */

/**
 * The context a skill receives.  Built by `HouseholdAgent` per
 * incoming message.
 *
 * @typedef {object} SkillContext
 * @property {import('./storage/Store.js').Store} store
 * @property {string}      chatId
 * @property {string}      senderWebid
 * @property {string}      bridgeId
 * @property {object}     [agent]           For tool-catalog access from classifyAndExtract
 */

/**
 * @typedef {(args: object, ctx: SkillContext) => Promise<Reply>} SkillHandler
 */

// ───────────────────────────────────────────────────────────────────
// Phase 2 — hybrid pod types
// ───────────────────────────────────────────────────────────────────

/**
 * The household's persistent config — lives at `/household/config.json`
 * on the shared household pod.
 *
 * @typedef {object} HouseholdConfig
 * @property {string}                 name
 *   Human-readable household name (e.g. "De Roos Family").
 * @property {string}                 groupKeyId
 *   Identifier for the household's encryption-by-ACL group key.  The
 *   actual key bytes live in the vault, not here.
 * @property {string}                 botWebid
 *   The bot's webid (lives on the bot's own pod).
 * @property {Array<MemberConfig>}    members
 *   Every human household member.  Bot is NOT in this list.
 * @property {HouseholdSettings}     [settings]
 */

/**
 * @typedef {object} MemberConfig
 * @property {string}                 webid
 *   Member's webid.  Authoritative identity.
 * @property {string}                 displayName
 *   Friendly name; not the source of truth for identity.
 * @property {'admin'|'member'|'guest'} role
 *   Track D role-aware-groups role.  Admins can manage the bot's pod.
 * @property {string|null}            podRoot
 *   URL of this member's per-member pod, if known.  Used by
 *   MemberPod operations.  Null means the member hasn't shared one yet
 *   (some items will fall back to the household pod).
 * @property {Record<string, BridgeBinding>} [bridges]
 *   Mapping from bridgeId (`'telegram'`) to per-bridge binding info
 *   (the bridgeUid that identifies this member on that platform).
 */

/**
 * @typedef {object} BridgeBinding
 * @property {string} bridgeUid    e.g. Telegram user id as string
 * @property {string} [handle]     e.g. Telegram @-handle, for display
 */

/**
 * @typedef {object} HouseholdSettings
 * @property {string}  [tz]                    IANA timezone, e.g. 'Europe/Amsterdam'
 * @property {number}  [nudgeDelayMs]          per-activity nudge default (Q-H2.7 = 1h)
 * @property {string}  [digestAtLocal]         daily digest (Q-H2.7 = '20:00')
 * @property {Record<string, ChatSettings>} [perChat]
 */

/**
 * @typedef {object} ChatSettings
 * @property {boolean} [archive]               Q-H2.2: persist raw chat to pod?
 * @property {boolean} [allowAmbient]          Q-H2.4 dropped in v0; reserved for future re-enable
 */

/**
 * The bot's persistent config — lives at `/bot/config.json` on the
 * bot's own pod.
 *
 * @typedef {object} BotConfig
 * @property {string}        pubkey
 *   The bot's public key (matches its webid's identity document).
 * @property {LlmConfig}    [llm]
 * @property {string}        promptVersion
 *   For prompt regression-tracking (Phase 3).
 */

/**
 * @typedef {object} LlmConfig
 * @property {'ollama'|'openai'|'anthropic'} provider
 * @property {string}                         model
 * @property {string}                        [baseUrl]
 * @property {string}                        [apiKeyEnvVar]   never the actual key
 */

/**
 * Item reference — when an item lives on a per-member pod but the
 * household pod needs to know about it (e.g. for cross-member listing).
 * Lives in the household pod under a `refs/` collection.
 *
 * @typedef {object} ItemRef
 * @property {string} id                     same id as the underlying Item
 * @property {ItemType} type
 * @property {string} ownerWebid             whose pod the item lives on
 * @property {string} ownerPodRoot
 * @property {string} relPath                path within ownerPodRoot
 * @property {number} addedAt                ms epoch (denormalised for sort)
 * @property {string|null} [excerpt]         optional short preview for listings
 */

// Empty export so this file is a real ES module.  Imports
// `@onderling-app/household/types` resolve cleanly.
export const __types__ = true;
