/** The delivery chip's words follow a known reason (one shared map, both shells), else the state's own label. */
import { describe, it, expect } from 'vitest';
import { deliveryPresentation } from '../../src/v2/deliverySettings.js';
import { DELIVERY_LABELS, DELIVERY_REASON_LABELS } from '../../src/v2/deliveryState.js';
import en from '../../src/locales/circle.en.json' with { type: 'json' };
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };

// the `circle.` namespace is the file itself (as DELIVERY_LABELS' own keys resolve)
const lookup = (bundle, key) => key.replace(/^circle\./, '').split('.').reduce((o, k) => o?.[k], bundle);

describe('a reason-specific delivery label', () => {
  it('persona-no-connection says so, stays retryable, keeps the failed shape', () => {
    const p = deliveryPresentation('failed', { reason: 'persona-no-connection' });
    expect(p.labelKey).toBe(DELIVERY_REASON_LABELS['persona-no-connection']);
    expect(p.retryable).toBe(true);
    expect(p.state).toBe('failed');
  });
  it('an unknown reason, or none, is the state\'s own label', () => {
    expect(deliveryPresentation('failed', { reason: 'something-else' }).labelKey).toBe(DELIVERY_LABELS.failed);
    expect(deliveryPresentation('failed').labelKey).toBe(DELIVERY_LABELS.failed);
  });
  it('every reason label resolves in nl and en', () => {
    expect(typeof lookup(en, DELIVERY_LABELS.undeliverable)?.text).toBe('string');   // the lookup reads the bundle as t() does
    for (const key of Object.values(DELIVERY_REASON_LABELS)) {
      expect(typeof lookup(en, key)?.text, `${key} en`).toBe("string");
      expect(typeof lookup(nl, key)?.text, `${key} nl`).toBe("string");
    }
  });
});
