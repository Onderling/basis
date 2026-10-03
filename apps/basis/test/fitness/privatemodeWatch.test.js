/**
 * FITNESS: the weekly Privatemode watch reads our models from the code, and finds a deprecation line about them — the
 * reader breaks loudly here, not silently on the schedule.
 */
import { describe, it, expect } from 'vitest';
import { ourModels, linesAbout } from '../../../../scripts/privatemode-release-watch.mjs';
import { PRIVATEMODE_DEFAULT_MODEL } from '@onderling/llm-client/providers/privatemode';
import { ASSISTANT_FALLBACK_MODEL } from '../../src/telegram/assistantLlm.js';

describe('FITNESS: the Privatemode release watch', () => {
  it('reads the bot\'s default and fallback model from the code', () => {
    expect(ourModels()).toEqual([PRIVATEMODE_DEFAULT_MODEL, ASSISTANT_FALLBACK_MODEL]);
  });
  it('finds a deprecation or removal that names one of them, written the way release notes write it', () => {
    const page = 'v1.58.0\nRemove Kimi K2.6. Migrate to GLM-5.3 or GLM-5.3-Flash.\nv1.57.0\nIncrease the context window of GLM-5.3.';
    expect(linesAbout(page, ['kimi-k2.6'])).toEqual(['Remove Kimi K2.6.']);
    expect(linesAbout(page, ['gpt-oss-120b'])).toEqual([]);
    expect(linesAbout('Model ID glm-5.2 is deprecated, it routes to GLM-5.3', ['glm-5.2'])).toHaveLength(1);
    // a model named only as the successor is not the news
    expect(linesAbout('Model ID glm-5.2 is deprecated, it routes to GLM-5.3 and will be removed in a future release.', ['glm-5.3'])).toEqual([]);
    expect(linesAbout('Kimi K2.6 is deprecated. Migrate to GLM-5.3 or GLM-5.3-Flash.', ['glm-5.3-flash'])).toEqual([]);
  });
});
