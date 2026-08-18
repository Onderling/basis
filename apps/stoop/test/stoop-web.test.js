/**
 * stoop-web smoke — + E.2 + E.3 + E.4 (PLAN-gui-chat-uplift.md).
 *
 * E.1 — first stoop web page consuming `renderWeb(stoopManifest)`:
 *       `mine.html` (my active posts + completions).
 * E.2 — second stoop web page consuming the NavModel:
 *       `privacy.html` (closed-beta disclosure + data-location).
 * E.3 — third stoop web page consuming the NavModel:
 *       `settings.html` (per-device + per-actor preferences).
 * E.4 — -adopt for profile.html: manifest declares the
 *       record-shape `profile` view + 3 representative identity
 *       fields (handle / displayName / holidayMode) with their
 *       patch ops.  Page is NOT migrated to renderWeb (591 lines,
 *       5 sections, custom UX — auto-rendering would regress).
 *
 * Boots the `apps/stoop/bin/stoop-web.js` bootstrap programmatically,
 * then verifies:
 *   1. `/navmodel.json` is served + carries the `mine` + `privacy` +
 *      `settings` + `profile` sections.
 *   2. `/stoop-config.json` carries the actor + group.
 *   3. `/mine.html` + `/privacy.html` + `/settings.html` are served
 *      + each carries the `data-navmodel-section` marker proving it
 *      picks up its section.  (profile.html intentionally NOT
 *      migrated — see E.4 note above.)
 *   4. The skill-dispatch path round-trips: `postRequest` then
 *      `listMyRequests` returns the freshly-added item filtered by
 *      LocalUiAuth-configured actor.
 *   5. The privacy page's two data-fetches (`getPrivacyNotice`,
 *      `getDataLocation`) round-trip cleanly.
 *   6. The settings page's `getSettings` / `updateSettings` round-
 *      trip cleanly (read → patch → read-back).
 *
 * Pattern mirrors `apps/household/test/web.test.js` — same shape
 * (programmatic startStoopWeb, same /tasks/send dispatch, same
 * LocalUiAuth-configured actor).  Note the existing `test/web.test.js`
 * still covers the legacy `stoop-ui.js`-style mount (production
 * launcher) — these two tests are complementary, not duplicate.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { startStoopWeb } from '../bin/stoop-web.js';

const ACTOR = 'https://id.example/anne';
const GROUP = 'block-42';

let handle, baseUrl;

beforeAll(async () => {
  handle  = await startStoopWeb({ port: 0, actor: ACTOR, group: GROUP });
  baseUrl = handle.url;
});

afterAll(async () => {
  await handle?.stop();
});

async function callSkill(skillId, data) {
  const res = await fetch(`${baseUrl}/tasks/send`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ skillId, message: { parts: [{ type: 'DataPart', data }] } }),
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.status).toBe('completed');
  return (json.artifacts?.[0]?.parts ?? []).find((p) => p?.type === 'DataPart')?.data ?? {};
}

describe('stoop-web smoke (Slice E.1 + E.2 + E.3 + E.4)', () => {
  it('serves /navmodel.json with the `mine` + `privacy` + `settings` + `profile` sections', async () => {
    const res = await fetch(`${baseUrl}/navmodel.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const nav = await res.json();
    expect(nav.app).toBe('stoop');
    // E.1 + E.2 + E.3 + E.4 ship FOUR web-page sections (mine / privacy /
    // settings / profile).  Part G dissolve (2026-06-17) APPENDED the
    // chat-shell `feed` + `contacts` views from the former
    // mockStoopManifest — they come AFTER the E.x pages so the original
    // four keep their declaration order + indices.  Order = manifest
    // .views[] order (: deterministic declaration order). D-mig-1a
    // (objective D, step 1a) APPENDED the `prikbord` list-surface view
    // (contacts pre-existed; it gained dataSource/label/category fields
    // but its position is unchanged) after `contacts`.
    expect(nav.sections.map((s) => s.id)).toEqual(['mine', 'privacy', 'settings', 'profile', 'feed', 'contacts', 'prikbord']);

    // D-mig-1a — the two live LIST-screen surfaces now project from the
    // manifest (additive groundwork; the app still reads LIST_SCREENS).
    const contacts = nav.sections.find((s) => s.id === 'contacts');
    expect(contacts.itemType).toBe('contact');
    expect(contacts.dataSource).toEqual({ skillId: 'listContacts' });
    expect(contacts.labelField).toBe('label');
    expect(contacts.categoryField).toBe('category');
    const prikbord = nav.sections.find((s) => s.id === 'prikbord');
    expect(prikbord.itemType).toBe('post');
    expect(prikbord.dataSource).toEqual({ skillId: 'listOpen' });
    expect(prikbord.categoryField).toBe('kind');
    expect(prikbord).not.toHaveProperty('labelField');

    const mine = nav.sections[0];
    expect(mine.id).toBe('mine');
    expect(mine.title).toBe('My posts');
    expect(mine.itemType).toBe('request');
    expect(mine.filter).toEqual({ open: true });
    // explicit dataSource declaration in the manifest.
    expect(mine.dataSource).toEqual({ skillId: 'listMyRequests' });
    // cancelRequest surfaces as an itemAction on the `mine` section
    // (renderWeb's appliesTo rule). Narrowed from `type: '*'` to the real content
    // nouns (#72, 2026-07-02) so it stops minting phantom `remove` capabilities on
    // stoop's internal itemTypes; the `mine` section (itemType 'request') still gets it.
    const cancel = (mine.itemActions ?? []).find((a) => a.opId === 'cancelRequest');
    expect(cancel).toBeDefined();
    expect(cancel.appliesTo.type).toEqual(['request', 'post', 'ask', 'offer', 'lend']);
    expect(cancel.appliesTo.type).toContain(mine.itemType);   // still covers the mine section

    // E.2 — privacy section.
    const privacy = nav.sections[1];
    expect(privacy.id).toBe('privacy');
    expect(privacy.title).toBe('Privacy — wat je moet weten');
    expect(privacy.itemType).toBe('group-rules');  // placeholder; see manifest note
    // read-only flag passed through verbatim.
    expect(privacy.readOnly).toBe(true);
    // (adopted 2026-05-21) — explicit dataSource with
    // argsFromContext. Replaces the workaround that
    // direct-called getPrivacyNotice; `$lang` now substitutes from
    // the browser-supplied context.
    expect(privacy.dataSource).toEqual({
      skillId:         'getPrivacyNotice',
      argsFromContext: { lang: '$lang' },
    });
    // readOnly: true suppresses creative-verb auto-surface
    // (affordances), so affordances[] is empty here.
    expect(privacy.affordances).toEqual([]);

    // E.3 — settings section.
    const settings = nav.sections[2];
    expect(settings.id).toBe('settings');
    expect(settings.title).toBe('Instellingen');
    expect(settings.itemType).toBe('group-rules');  // placeholder; settings is
                                                    // singleton-record
    // explicit dataSource declaration in the manifest
    // (`getSettings({})` is param-free — perfect fit).
    expect(settings.dataSource).toEqual({ skillId: 'getSettings' });
    // (adopted 2026-05-21) — shape: 'record' marks this
    // section as a singleton (matches getSettings's reality).
    expect(settings.shape).toBe('record');
    // (adopted 2026-05-22) — section.fields[] surfaces the
    // editable settings fields declared in the manifest.  Subset
    // adoption — declares 4 representative fields covering both the
    // direct-arg op (setHopMode) and the wrapped-patch op
    // (updateSettings).
    expect(Array.isArray(settings.fields)).toBe(true);
    expect(settings.fields.length).toBeGreaterThanOrEqual(4);
    const byName = Object.fromEntries(settings.fields.map((f) => [f.name, f]));
    // hopThrough — setHopMode direct-arg.
    expect(byName.hopThrough.type).toBe('boolean');
    expect(byName.hopThrough.patch).toEqual({ opId: 'setHopMode', argName: 'global' });
    // adoption — labelKey passthrough on all 4 settings fields.
    expect(byName.hopThrough.labelKey).toBe('settings.hop_label');
    expect(byName.pollIntervalMs.labelKey).toBe('settings.poll_interval_label');
    expect(byName.broadcastable.labelKey).toBe('settings.broadcastable_label');
    expect(byName.defaultShareLocation.labelKey).toBe('settings.default_share_location_label');
    // pollIntervalMs — updateSettings wrapped-patch.
    expect(byName.pollIntervalMs.type).toBe('enum');
    expect(byName.pollIntervalMs.choices).toEqual([2000, 10000, 60000, 300000]);
    expect(byName.pollIntervalMs.patch).toEqual({
      opId: 'updateSettings', argName: 'pollIntervalMs',
    });
    // E.3 deliberately does NOT set `readOnly: true` (settings mutates
    // via per-field skills).  But because the per-field skills
    // (`updateSettings`, `setHopMode`) aren't manifest ops, no
    // creative-verb affordances surface here — settings is #6
    // territory (record-shape patch mutations don't fit add/register).
    expect(settings.readOnly).toBeUndefined();
    expect(settings.affordances).toEqual([]);

    // E.4 — profile section. -adopt mirrors settings: manifest
    // declares the record-shape view + fields[]; profile.html keeps
    // its rich custom UI (591 lines, 5 sections — auto-rendering
    // would regress UX).
    const profile = nav.sections[3];
    expect(profile.id).toBe('profile');
    expect(profile.title).toBe('Mijn profiel');
    expect(profile.itemType).toBe('group-rules');  // placeholder; profile is
                                                   // singleton-record (same
                                                   // pattern as settings + privacy)
    // shape: 'record' marks this section as a singleton.
    expect(profile.shape).toBe('record');
    // explicit dataSource (`getMyProfile({})` is param-free).
    expect(profile.dataSource).toEqual({ skillId: 'getMyProfile' });
    // (adopted 2026-05-22) — section.fields[] surfaces the
    // editable identity fields declared in the manifest.  Subset
    // adoption — declares 3 representative fields covering the
    // primary identity dimensions (handle / displayName /
    // holidayMode). All FLAT dispatch (no argWrapper)
    // getMyProfile-backed mutations are single-arg skills.
    expect(Array.isArray(profile.fields)).toBe(true);
    expect(profile.fields.length).toBeGreaterThanOrEqual(3);
    const profileByName = Object.fromEntries(profile.fields.map((f) => [f.name, f]));
    // handle — setMyHandle direct-arg.
    expect(profileByName.handle.type).toBe('string');
    expect(profileByName.handle.patch).toEqual({ opId: 'setMyHandle', argName: 'handle' });
    // displayName — setMyDisplayName direct-arg.
    expect(profileByName.displayName.type).toBe('string');
    expect(profileByName.displayName.patch).toEqual({
      opId: 'setMyDisplayName', argName: 'displayName',
    });
    // holidayMode — setHolidayMode direct-arg; argName is the SKILL ARG
    // (`on`), not the field-on-entry name (`holidayMode`).  Same
    // semantic split settings's hopThrough → setHopMode({global}) uses.
    expect(profileByName.holidayMode.type).toBe('boolean');
    expect(profileByName.holidayMode.patch).toEqual({
      opId: 'setHolidayMode', argName: 'on',
    });
    // adoption — labelKey passthrough on all 3 profile fields.
    expect(profileByName.handle.labelKey).toBe('profile.handle_label');
    expect(profileByName.displayName.labelKey).toBe('profile.display_name_label');
    expect(profileByName.holidayMode.labelKey).toBe('profile.holiday_label');
    // adoption — holidayMode declares readSkill so adapters
    // can do single-field refresh via getHolidayMode without re-
    // fetching the whole profile.  E.4 was the originating signal.
    expect(profileByName.holidayMode.readSkill).toEqual({ skillId: 'getHolidayMode' });
    // handle + displayName have no dedicated single-field read skill;
    // assert absence so accidental projections are caught.
    expect(profileByName.handle).not.toHaveProperty('readSkill');
    expect(profileByName.displayName).not.toHaveProperty('readSkill');
    // E.4 deliberately does NOT set `readOnly: true` (profile mutates
    // via per-field skills).  Like settings, the per-field skills
    // (`setMyHandle`, `setMyDisplayName`, `setHolidayMode`) aren't
    // manifest ops, so no creative-verb affordances surface here.
    expect(profile.readOnly).toBeUndefined();
    expect(profile.affordances).toEqual([]);
  });

  it('serves /stoop-config.json with the actor + group', async () => {
    const res = await fetch(`${baseUrl}/stoop-config.json`);
    expect(res.status).toBe(200);
    const cfg = await res.json();
    expect(cfg.actor).toBe(ACTOR);
    expect(cfg.group).toBe(GROUP);
    expect(cfg.app).toBe('stoop');
  });

  it('serves /lib/web-adapter/fetchSectionItems.js (V0.2 helper overlay)', async () => {
    // The helpers are overlaid by `bin/stoop-web.js`'s
    // `extraStaticFiles` so `mine.html` can `import` them at runtime
    // (same mechanism tasks-v0 uses).
    const res = await fetch(`${baseUrl}/lib/web-adapter/fetchSectionItems.js`);
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain('export async function fetchSectionItems');
  });

  it('serves /lib/web-adapter/itemMatchesAppliesTo.js (V0.2 helper overlay)', async () => {
    const res = await fetch(`${baseUrl}/lib/web-adapter/itemMatchesAppliesTo.js`);
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain('export function itemMatchesAppliesTo');
  });

  it('exposes the agent card at /.well-known/agent.json', async () => {
    const res = await fetch(`${baseUrl}/.well-known/agent.json`);
    expect(res.status).toBe(200);
    const card = await res.json();
    expect(card).toHaveProperty('skills');
  });

  it('privacy data-fetches round-trip (getPrivacyNotice + getDataLocation)', async () => {
    // getPrivacyNotice is lang-aware (gap #3: dataSource.args is
    // static; this fetch stays direct-called in the page).
    const notice = await callSkill('getPrivacyNotice', { lang: 'nl' });
    expect(notice.lang).toBe('nl');
    expect(Array.isArray(notice.sections)).toBe(true);
    expect(notice.sections.length).toBeGreaterThan(0);
    for (const s of notice.sections) {
      expect(typeof s.heading).toBe('string');
      expect(typeof s.body).toBe('string');
    }

    // getDataLocation is param-free — the dataSource skillId declared
    // in the manifest.  `fetchSectionItems` calls it with `{}`.
    const loc = await callSkill('getDataLocation', {});
    // Shape: relayOperator / relayUrl / podIssuer / podRoot (any may
    // be unset in the smoke bundle; the page renders them with a
    // localised "— niet ingesteld —" fallback).  Just verify the
    // skill responds with an object.
    expect(typeof loc).toBe('object');
    expect(loc).not.toBeNull();
  });

  it('settings data-fetches round-trip (getSettings + updateSettings)', async () => {
    // getSettings is param-free — it's the dataSource skillId declared
    // in the manifest.  `fetchSectionItems` calls it with `{}`.
    // signal #5: settings is a SINGLETON record (`{settings: {...}}`),
    // not a list of items — the page extracts `.settings` directly.
    const r1 = await callSkill('getSettings', {});
    expect(typeof r1).toBe('object');
    expect(r1).not.toBeNull();
    expect('settings' in r1).toBe(true);  // record-shape envelope

    // updateSettings({patch}) — per-field mutation path (NOT a
    // manifest op; this is signal #6 — record-shape patch
    // mutations don't fit 's add/register creative-verb model).
    // Round-trip: patch broadcastable=false, then read it back.
    const r2 = await callSkill('updateSettings', { patch: { broadcastable: false } });
    expect(r2.settings).toBeDefined();
    expect(r2.settings.broadcastable).toBe(false);

    const r3 = await callSkill('getSettings', {});
    expect(r3.settings.broadcastable).toBe(false);
  });

  it('postRequest → listMyRequests round-trips via LocalUiAuth', async () => {
    // Post as ANNE (the LocalUiAuth-configured actor); listMyRequests
    // filters by addedBy=from, so ANNE should see her own item.
    const posted = await callSkill('postRequest', {
      text:         'borrow a ladder',
      intent:       'ask',
      timeoutMs:    1,
      expectClaims: 0,
    });
    expect(posted.requestId).toBeTruthy();

    const mine = await callSkill('listMyRequests', {});
    expect(Array.isArray(mine.items)).toBe(true);
    expect(mine.items.length).toBeGreaterThanOrEqual(1);
    expect(mine.items.some((i) => i.id === posted.requestId)).toBe(true);
    // All returned items belong to the calling actor.
    for (const item of mine.items) {
      expect(item.addedBy).toBe(ACTOR);
    }
  });
});
