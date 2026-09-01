/**
 * embed-button computation coverage.
 */
import { describe, it, expect } from 'vitest';
import { computeEmbedButtons } from '../../src/core/embedButtons.js';

const folioManifest = {
  operations: [
    { id: 'downloadFile', appliesTo: { type: 'file' },
      surfaces: { ui: { control: 'button', label: 'Download' } } },
    { id: 'saveToMyPod',  appliesTo: { type: 'file' },
      surfaces: { ui: { control: 'button', label: 'Save to my pod' } } },
    { id: 'getFileSnapshot', // no surfaces.ui — should NOT produce a button
      appliesTo: { type: 'file' } },
  ],
};

const calendarManifest = {
  operations: [
    { id: 'rsvpAccept',  appliesTo: { type: 'calendar-event', state: 'open' },
      surfaces: { ui: { control: 'button', label: 'Accept' } } },
    { id: 'rsvpDecline', appliesTo: { type: 'calendar-event', state: 'open' },
      surfaces: { ui: { control: 'button', label: 'Decline' } } },
    { id: 'rsvpTentative', appliesTo: { type: 'calendar-event', state: 'open' },
      surfaces: { ui: { control: 'button', label: 'Tentative' } } },
  ],
};

describe('computeEmbedButtons', () => {
  it('returns [] when manifestsByOrigin is missing', () => {
    expect(computeEmbedButtons({ embed: { appOrigin: 'folio', snapshot: {} } })).toEqual([]);
    expect(computeEmbedButtons({ manifestsByOrigin: null, embed: { appOrigin: 'folio' } })).toEqual([]);
  });

  it('returns [] when manifest for the embed.appOrigin is missing', () => {
    const out = computeEmbedButtons({
      manifestsByOrigin: { stoop: {} },
      embed: { appOrigin: 'folio', snapshot: { id: 'f1', type: 'file' } },
    });
    expect(out).toEqual([]);
  });

  it('surfaces folio file-card actions: Download + Save to my pod', () => {
    const out = computeEmbedButtons({
      manifestsByOrigin: { folio: folioManifest },
      embed: { appOrigin: 'folio', snapshot: { id: 'f1', type: 'file' } },
    });
    expect(out).toHaveLength(2);
    expect(out.map((b) => b.opId)).toEqual(['downloadFile', 'saveToMyPod']);
    expect(out[0]).toEqual({
      label: 'Download', callbackData: 'downloadFile:f1',
      // `app` rides along so a DEVICE row action ("share this here") knows whose item it is, instead of
      // leaving the snapshot read to take whichever app declares one first.
      opId: 'downloadFile', itemId: 'f1', app: 'folio',
    });
  });

  it('skips operations without surfaces.ui.control === button', () => {
    const out = computeEmbedButtons({
      manifestsByOrigin: { folio: folioManifest },
      embed: { appOrigin: 'folio', snapshot: { id: 'f1', type: 'file' } },
    });
    expect(out.find((b) => b.opId === 'getFileSnapshot')).toBeUndefined();
  });

  it('respects appliesTo.type', () => {
    const out = computeEmbedButtons({
      manifestsByOrigin: { folio: folioManifest },
      embed: { appOrigin: 'folio', snapshot: { id: 'x1', type: 'folder' } },
    });
    expect(out).toEqual([]);
  });

  it('respects appliesTo.state for calendar invites', () => {
    const open = computeEmbedButtons({
      manifestsByOrigin: { calendar: calendarManifest },
      embed: { appOrigin: 'calendar', snapshot: { id: 'e1', type: 'calendar-event', state: 'open' } },
    });
    expect(open.map((b) => b.opId)).toEqual(['rsvpAccept', 'rsvpDecline', 'rsvpTentative']);

    const closed = computeEmbedButtons({
      manifestsByOrigin: { calendar: calendarManifest },
      embed: { appOrigin: 'calendar', snapshot: { id: 'e1', type: 'calendar-event', state: 'cancelled' } },
    });
    expect(closed).toEqual([]);
  });

  it('does not let snapshot.fields.state override snapshot.state', () => {
    const out = computeEmbedButtons({
      manifestsByOrigin: { calendar: calendarManifest },
      embed: { appOrigin: 'calendar', snapshot: {
        id: 'e1', type: 'calendar-event', state: 'cancelled',
        fields: { state: 'open' },     // attempt to lie via fields
      }},
    });
    expect(out).toEqual([]);
  });
});
