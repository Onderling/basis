/**
 * THE BLOCKED LIST NAMES WHO WAS BLOCKED, never by key. A block is made with one tap on a post, and the only id the tap
 * has is a key; the list showed that key (whole on the admin page, shortened on the Blocked screen). The block now keeps
 * the name the person saw and the day, and every blocked list reads one projection: a roster name, else the kept name,
 * else "someone" — always with the day. Unblocking still goes by the stored key.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { loadMuteSet } from '@onderling/secure-agent';
import { buildBlockedList } from '../../src/v2/blockedList.js';
import { blockedRowWords } from '../../src/v2/blockedWords.js';

const KEY = 'PflwUn2aVLieLdb-DW-0VkmQH6ZMMq4WRRGlBolrrtw';
const AT = Date.UTC(2026, 10, 6, 12);
const t = (k, v = {}) => ({
  'circle.admin.muted_row': `${v.name} (geblokkeerd ${v.date})`,
  'circle.admin.muted_row_unnamed': `Iemand (geblokkeerd ${v.date})`,
  'circle.reply.who_someone': 'iemand',
}[k] ?? k);

describe('the blocked list', () => {
  it('keeps the name the person saw and the day with the block, across a reload', async () => {
    const vault = new VaultMemory();
    const set = await loadMuteSet({ vault, vaultKey: 'mute' });
    await set.add(KEY, { label: 'Jan', at: AT });
    const again = await loadMuteSet({ vault, vaultKey: 'mute' });
    expect(again.has(KEY)).toBe(true);
    expect(again.entries()).toEqual([{ key: KEY, label: 'Jan', at: AT }]);
  });

  it('a block written before names were kept still loads, and still blocks', async () => {
    const vault = new VaultMemory();
    await vault.set('mute', JSON.stringify([KEY]));
    const set = await loadMuteSet({ vault, vaultKey: 'mute' });
    expect(set.has(KEY)).toBe(true);
    expect(set.entries()[0].label).toBeNull();
  });

  it('a row reads the kept name and the day — "Jan (geblokkeerd 6 nov)", never the key', () => {
    const [row] = buildBlockedList({ peers: [KEY], entries: [{ key: KEY, label: 'Jan', at: AT }], members: [] });
    expect(row.key).toBe(KEY);
    const w = blockedRowWords(row, { t, lang: 'nl', tz: 'Europe/Amsterdam' });
    expect(w).toBe('Jan (geblokkeerd 6 nov)');
  });

  it('a block with no name kept reads "Iemand (geblokkeerd …)", and never shows any piece of the key', () => {
    const [row] = buildBlockedList({ peers: [KEY], entries: [{ key: KEY, label: null, at: AT }], members: [] });
    const w = blockedRowWords(row, { t, lang: 'nl', tz: 'Europe/Amsterdam' });
    expect(w).toBe('Iemand (geblokkeerd 6 nov)');
    expect(w).not.toContain(KEY.slice(0, 6));
  });

  it('a roster name still wins over the kept one (the person may have renamed since)', () => {
    const [row] = buildBlockedList({ peers: [KEY], entries: [{ key: KEY, label: 'Jan', at: AT }], members: [{ webid: KEY, displayName: 'Jan de Vries' }] });
    expect(row.label).toBe('Jan de Vries');
  });
});
