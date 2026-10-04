/**
 * `/help` on a household bot reads as a person's list (the real bot, 2026-10-02: English developer hints, the admin's
 * commands without a word): their language, grouped, the admin's last — and a member sees no admin section at all.
 */
import { describe, it, expect } from 'vitest';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { scopeCatalogueToRole } from '../src/v2/botOpMap.js';
import { botHelpLines, isAdminOp as isAdmin } from '../src/v2/botHelp.js';
import nl from '../src/locales/circle.nl.json' with { type: 'json' };

const t = (k) => { const v = k.split('.').slice(1).reduce((o, x) => o?.[x], nl); return typeof v === 'string' ? v : k; };
const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });
const helpFor = (role) => botHelpLines({ commandMenu: scopeCatalogueToRole(catalogue, role).commandMenu, opsById: catalogue.opsById, isAdmin, t }).join('\n');

describe('/help for a person', () => {
  it('a member: Dutch, grouped, no developer words, no admin section', () => {
    const h = helpFor('member');
    expect(h).toContain('Lijsten:');
    expect(h).toContain('/claim — een klusje oppakken');
    expect(h).toContain('/instellingen — je instellingen, met knoppen');
    expect(h).not.toMatch(/Compare-and-swap|calling actor|circle\.bot/);
    expect(h).not.toContain('Voor de beheerder');
  });
  it('the admin: the admin\'s commands last, each worded', () => {
    const h = helpFor('admin');
    const admin = h.slice(h.indexOf('Voor de beheerder:'));
    expect(h.indexOf('Voor de beheerder:')).toBeGreaterThan(h.indexOf('Jij:'));
    expect(admin).toContain('/huishouden — instellingen voor het hele huishouden');
    expect(admin).toContain('/invite — een code voor één persoon');
    expect(admin.split('\n').slice(1).every((l) => l.includes(' — '))).toBe(true);
  });
});
