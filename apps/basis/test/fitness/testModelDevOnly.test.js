/**
 * FITNESS: the browser specs' stand-in model is read by DEVELOPMENT builds only. A released page that let a script
 * on it replace the circle bot's model would be a way to steer the bot; the shell reads `window.__onderlingTestModel`
 * only under `import.meta.env.DEV`, which a production build folds to false.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const web = readFileSync(new URL('../../web/v2/circleApp.js', import.meta.url), 'utf8');

describe('FITNESS: the stand-in model is development-only', () => {
  it('web reads it under import.meta.env.DEV, and nowhere else', () => {
    expect(web).toMatch(/const testModel = import\.meta\.env\?\.DEV \? readTestModel\(globalThis\) : null;/);
    expect(web.match(/readTestModel\(/g)).toHaveLength(1);
    expect(web).not.toMatch(/__onderlingTestModel/);
  });
});
