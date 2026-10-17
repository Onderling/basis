/**
 * Two-mode rendering contract.
 *
 * Every bundle registering a type must supply BOTH renderer
 * functions:
 *   - `compact(item, ctx?)` — chip / row / card for an embedded ref
 *     (a task inside a Pinboard post; a supply-offer inside a Tasks task).
 *     Should fit in a single line of UI space.
 *   - `full(item, ctx?)`    — detail view for a direct view of the
 *     resource (the user tapped through to see the whole thing).
 *
 * Both renderers are renderer-agnostic — substrate doesn't impose a
 * React / DOM / CLI choice. They return whatever shape the consuming
 * platform expects (React Native components on phone, plain text on
 * CLI, HTML/text fragments on the desktop). The substrate just
 * brokers the registration + lookup; the rendering layer interprets.
 *
 * Standardisation Phase 52.12.3.
 *
 * @typedef {(item: object, ctx?: object) => any} RendererFn
 *
 * @typedef {object} RendererPair
 * @property {RendererFn} compact
 * @property {RendererFn} full
 *
 * @typedef {object} RegistrationEntry
 * @property {string}       type
 * @property {string}       bundleId
 * @property {RendererPair} renderer
 * @property {Array<object>} actions       — optional caller-defined action descriptors
 * @property {string}       registeredAt   — ISO timestamp
 */

/**
 * Validate that a renderer pair has both modes as functions.
 * Throws INVALID_RENDERER otherwise.
 */
export function validateRendererPair(renderer) {
  if (!renderer || typeof renderer !== 'object') {
    throw Object.assign(
      new Error('renderer must be an object with `compact` + `full` functions'),
      { code: 'INVALID_RENDERER' },
    );
  }
  if (typeof renderer.compact !== 'function') {
    throw Object.assign(
      new Error('renderer.compact must be a function'),
      { code: 'INVALID_RENDERER' },
    );
  }
  if (typeof renderer.full !== 'function') {
    throw Object.assign(
      new Error('renderer.full must be a function'),
      { code: 'INVALID_RENDERER' },
    );
  }
}
