/**
 * Three doors into the lists feature, one op behind each.
 *
 * The "+", a typed command and the Lists screen are three ways to do the same thing, and for a while
 * only two of them went through the contract: the panel called the service directly (`svc.addItem(…)`),
 * so "screen ≡ chat ≡ +" was a claim. It is checkable, so it is checked — `src/screens/**` and the web
 * shell have no runtime coverage, which is why an omission there fails nothing.
 *
 * READS may stay on the service: a screen projecting its own containers is not a second write path.
 * WRITES may not — that is where the op, its declaration and its fan-out live.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');
const WEB    = read('../../web/v2/circleApp.js');
const MOBILE = read('../../../basis-mobile/src/screens/v2/CircleListsScreen.js');

/** The write verbs of the lists service — the ones that must go through an op. */
const WRITES = ['addItem', 'markDone', 'createList'];

describe('the lists feature has one write path, whichever door you came through', () => {
  it('the web panel dispatches its writes as ops', () => {
    expect(WEB).toMatch(/rawCallSkill\('lists', 'addToList'/);
    expect(WEB).toMatch(/rawCallSkill\('lists', 'markListItemDone'/);
    expect(WEB).toMatch(/rawCallSkill\('lists', 'createList'/);
  });

  it('the mobile screen dispatches its writes as ops', () => {
    expect(MOBILE).toMatch(/callSkill\?\.\('lists', 'addToList'/);
    expect(MOBILE).toMatch(/callSkill\?\.\('lists', 'markListItemDone'/);
    expect(MOBILE).toMatch(/callSkill\?\.\('lists', 'createList'/);
  });

  it('and neither shell writes straight to the service any more', () => {
    // `svc.tree` / `svc.listContainers` / `svc.addKinds` are READS and projections — allowed, and named
    // here so the check is about writes rather than about the word `svc`.
    for (const [name, src] of [['web', WEB], ['mobile', MOBILE]]) {
      for (const verb of WRITES) {
        const direct = new RegExp(`svc(Ref\\.current)?\\.${verb}\\s*\\(`);
        // `createBoard` is deliberately still on the service (no op declares it yet) — when it gains one
        // this list grows, which is the conversation to have.
        expect(direct.test(src), `${name} calls svc.${verb} directly — that is a second write path`).toBe(false);
      }
    }
  });

  it('the op that names a list declares a PICKER for it, so every door asks the same question', () => {
    // `pickerSource` is the one way the app says "this param names a thing that already exists": the
    // form draws a chooser, the chat offers the candidates as buttons. Without it the "+" opens a
    // free-text field and the two doors ask differently — which is the divergence this pins shut.
    const manifest = read('../../../lists/manifest.js');
    expect(manifest).toMatch(/pickerSource:\s*\{\s*listOp:\s*'listLists'/);
  });
});
