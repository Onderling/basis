import { describe, it, expect } from 'vitest';
import { missingIn } from './lint-screen-sections.mjs';

describe('lint-screen-sections', () => {
  it('a shell that paints from the list and names every id lacks nothing', () => {
    expect(missingIn("sectionsOf('adminPanel'); openSection('admin-members'); openSection('admin-muted');", 'adminPanel', ['admin-members', 'admin-muted'])).toEqual([]);
  });
  it('a shell that hand-lists, or misses a section, is named', () => {
    expect(missingIn("openSection('admin-members')", 'adminPanel', ['admin-members', 'admin-outbound-shares'])).toEqual(["sectionsOf('adminPanel')", 'admin-outbound-shares']);
  });
});
