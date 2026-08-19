/**
 * The cross-circle container UI in the circle: the Lists panel renders a `list` container with its
 * `list-item` children nested (projectContainer→renderContainerCard); "+ add" creates a contained child;
 * a row-action completes it. The composable model, live in the app.
 */
import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

test.setTimeout(70_000);

test('Lists panel: create a list, add a nested item, complete it', async ({ page }) => {
  await bootCircle(page, 'Lists Circle');

  // open the circle more-menu → Lists
  await page.locator('.circle-circle__more').click();
  await page.waitForTimeout(400);
  await page.locator('.circle-circle__more-item[data-action="lists"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('.cc-lists-panel')).toBeVisible();

  // create a list
  await page.locator('.cc-lists-panel__new-input').fill('groceries');
  await page.locator('.cc-lists-panel__new-input').press('Enter');   // form submit → createList (List is the default creator)
  await page.waitForTimeout(300);
  const listRow = page.locator('.cc-lists-panel__list', { hasText: 'groceries' });
  await expect(listRow).toBeVisible();

  // open the list → its container card
  await listRow.click();
  await page.waitForTimeout(300);
  await expect(page.locator('.circle-container-card')).toBeVisible();
  await expect(page.locator('.circle-container-card')).toContainText('groceries');

  // add an item — "+ add" reveals an inline input; fill + submit
  await page.locator('.circle-container-card__add').click();
  await page.locator('.cc-lists-panel__add-input').fill('milk');
  await page.locator('.cc-lists-panel__add-form .cc-lists-panel__create').click();
  await page.waitForTimeout(400);
  const itemRow = page.locator('.circle-container-card__row[data-type="list-item"]');
  await expect(itemRow).toContainText('milk');                       // the child is CONTAINED + rendered nested

  // complete it → the row shows the ✓ prefix
  await itemRow.locator('[data-op="markComplete"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('.circle-container-card__row[data-type="list-item"]')).toContainText('✓ milk');
});

test('board container: "+ add" shows the ambiguous-type picker → pick Item', async ({ page }) => {
  await bootCircle(page, 'Board Circle');
  await page.locator('.circle-circle__more').click();
  await page.waitForTimeout(400);
  await page.locator('.circle-circle__more-item[data-action="lists"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('.cc-lists-panel')).toBeVisible();

  // create a BOARD (the alt creator) — a container that accepts an Item OR a List, no default
  await page.locator('.cc-lists-panel__new-input').fill('project');
  await page.locator('.cc-lists-panel__create--alt').click();          // "Board"
  await page.waitForTimeout(300);
  const boardRow = page.locator('.cc-lists-panel__list[data-type="board"]', { hasText: 'project' });
  await expect(boardRow).toBeVisible();
  await boardRow.click();
  await page.waitForTimeout(300);

  // "+ add" on the board → the TYPE PICKER (no default → a choice), NOT a straight input
  await page.locator('.circle-container-card__add').click();
  await page.waitForTimeout(200);
  await expect(page.locator('.cc-lists-panel__pick')).toBeVisible();
  await expect(page.locator('.cc-lists-panel__pick-btn[data-pick-type="list-item"]')).toBeVisible();
  await expect(page.locator('.cc-lists-panel__pick-btn[data-pick-type="list"]')).toBeVisible();

  // pick "Item" → input → milk → the item lands as a list-item
  await page.locator('.cc-lists-panel__pick-btn[data-pick-type="list-item"]').click();
  await page.locator('.cc-lists-panel__add-input').fill('milk');
  await page.locator('.cc-lists-panel__add-form .cc-lists-panel__create').click();
  await page.waitForTimeout(400);
  await expect(page.locator('.circle-container-card__row[data-type="list-item"]')).toContainText('milk');
});
