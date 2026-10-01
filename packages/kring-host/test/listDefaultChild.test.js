/**
 * A list says what a bare add makes: a chores list makes a TASK, a shopping list a plain entry.
 *
 * The default child used to belong to the container TYPE (every `list` → `list-item`), so a household's "Klusjes"
 * list could not default to tasks while "Boodschappen" kept plain entries. A list now carries an optional
 * `defaultChild` — one of the kinds its type accepts — and a bare add follows it; naming a kind still wins; a
 * `defaultChild` its type does not accept is ignored (the type's default applies), never trusted.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { makeCircleLists } from '../src/circleLists.js';

describe('a list\'s own default child', () => {
  it('a bare add to Klusjes makes a task; to Boodschappen a list-item', async () => {
    const svc = makeCircleLists({ dataSource: memoryDataSource() });
    const klusjes = await svc.createList('c1', 'Klusjes', 'me', { defaultChild: 'task' });
    const boodschappen = await svc.createList('c1', 'Boodschappen', 'me');
    expect(klusjes.defaultChild).toBe('task');
    expect((await svc.addItem('c1', klusjes.id, 'band plakken', 'me')).type).toBe('task');
    expect((await svc.addItem('c1', boodschappen.id, 'melk', 'me')).type).toBe('list-item');
  });

  it('naming a kind still wins over the list\'s default', async () => {
    const svc = makeCircleLists({ dataSource: memoryDataSource() });
    const klusjes = await svc.createList('c1', 'Klusjes', 'me', { defaultChild: 'task' });
    expect((await svc.addItem('c1', klusjes.id, 'notitie', 'me', { hint: 'list-item' })).type).toBe('list-item');
  });

  it('a default the list type does not accept is not stored', async () => {
    const svc = makeCircleLists({ dataSource: memoryDataSource() });
    const odd = await svc.createList('c1', 'Raar', 'me', { defaultChild: 'spaceship' });
    expect(odd.defaultChild).toBeUndefined();
    expect((await svc.addItem('c1', odd.id, 'x', 'me')).type).toBe('list-item');
  });
});
