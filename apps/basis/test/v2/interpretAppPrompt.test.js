/**
 * THE APP'S OWN BACKGROUND REACHES THE INTERPRETER (decided 2026-09-25): the active app's manifest
 * `systemPrompt` is APPENDED to the generic interpreter prompt — it never replaces it. Until now only the standalone
 * household agent used the household background (via `renderChat`); basis's assistant on web, mobile and Telegram
 * interpreted household requests with the generic prompt and the tool descriptors alone.
 *
 * "Active" = an app whose ops are in the catalogue the interpreter was handed — so a circle's scoped catalogue brings
 * only its own apps' backgrounds, and one without household brings none of it.
 */
import { describe, it, expect } from 'vitest';
import { interpretToCommand, DEFAULT_INTERPRET_SYSTEM } from '../../src/v2/interpretCommand.js';
import { mergeManifests } from '../../src/manifestMerge.js';
import { scopeCatalogueToApps } from '../../src/v2/circleCatalogueScope.js';
import { householdManifest } from '../../../household/manifest.js';

function capturingLlm() {
  const seen = [];
  return { seen, invoke: async (req) => { seen.push(req.system); return { text: 'ok' }; } };
}

describe('the interpreter hears the active app\'s own background', () => {
  it('household in the catalogue → its systemPrompt follows the generic prompt', async () => {
    expect(typeof householdManifest.systemPrompt, 'the fixture has a background').toBe('string');
    const llm = capturingLlm();
    await interpretToCommand('zet melk op de lijst', { catalogue: mergeManifests([{ manifest: householdManifest }]), llm });
    const system = llm.seen[0];
    expect(system.startsWith(DEFAULT_INTERPRET_SYSTEM), 'the generic prompt stays first — appended, never replaced').toBe(true);
    expect(system).toContain(householdManifest.systemPrompt);
  });

  it('household scoped OUT of the circle → none of its background', async () => {
    const llm = capturingLlm();
    const merged = mergeManifests([{ manifest: householdManifest }]);
    const scoped = scopeCatalogueToApps(merged, ['tasks']);
    await interpretToCommand('zet melk op de lijst', { catalogue: scoped, llm }).catch(() => null);
    for (const s of llm.seen) expect(s).not.toContain(householdManifest.systemPrompt);
  });
});
