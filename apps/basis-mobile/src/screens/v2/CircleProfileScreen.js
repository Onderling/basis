/**
 * basis-mobile v2 — profile (Mij) screen (RN, S2 parity).
 *
 * RN mirror of web's circleProfile: identity (handle + display name), personal
 * offerings (taxonomy picker as tappable chips), and coarse location (geocode).
 * Self-contained: loads getMyProfile/listOfferingCategories + dispatches the stoop
 * mutations via the injected `callSkill`. Availability/quiet-hours is a sub-screen
 * reached via `onAvailability`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t, lang } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { plannedForMe, plannedLines } from '../../../../basis/src/v2/plannedForMe.js';
import { personWeekOn, switchPersonWeek } from '../../../../basis/src/v2/personWeekOverview.js';
import { mijOverviewBlocks, MIJ_OVERVIEW_TITLE_KEY } from '../../../../basis/src/v2/mijOverview.js';
import CircleScreenView from './CircleScreenView.js';

export default function CircleProfileScreen({ callSkill, personClock = null, onAvailability, onMyData, onSharedWithMe, onOpenMij, onAdvanced, onBlocked, onShareContact }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();   // clear the status bar: the title and scrolled content drew under it
  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);
  const [profile, setProfile] = useState({});
  // The identity fields are editable only once the profile has ANSWERED: before that they are empty, and what
  // someone typed there was overwritten when the load landed a few seconds later (seen on a phone, 2026-10-08).
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [categories, setCategories] = useState([]);
  const [handle, setHandle] = useState('');
  const [display, setDisplay] = useState('');
  const [geoQuery, setGeoQuery] = useState('');
  const [geoResult, setGeoResult] = useState(null);
  const [busy, setBusy] = useState(false);
  // Gepland: what is coming for me, wherever it lives — read on this device (no bot); null while it loads
  const [planned, setPlanned] = useState(null);
  // Mijn overzicht, below Gepland: my chores across every circle (the shared block); null while it loads
  const [overview, setOverview] = useState(null);
  // the person's own week overview: on · off · null while it loads or switches (absent: no clock here)
  const [weekOn, setWeekOn] = useState(undefined);
  const meRef = useRef(null);

  const load = useCallback(async () => {
    if (typeof callSkill !== 'function') return;
    const [prof, cats] = await Promise.all([
      callSkill('stoop', 'getMyProfile', {}).catch(() => null),
      callSkill('stoop', 'listOfferingCategories', { lang: lang() }).catch(() => null),
    ]);
    const entry = prof?.entry ?? {};
    setProfile(entry);
    setHandle(entry.handle ?? '');
    setDisplay(entry.displayName ?? '');
    if (prof) setProfileLoaded(true);
    setCategories(Array.isArray(cats?.categories) ? cats.categories : []);
    try {
      const me = (await callSkill('stoop', 'whoAmI', {}).catch(() => null))?.webid ?? null;
      meRef.current = me;
      // the overview beside Gepland, not waiting on it (a block that fails says so under its own title)
      mijOverviewBlocks({ callSkill, me }).then(setOverview);
      const clock = personClock ? await personClock : null;
      if (clock && me) setWeekOn(personWeekOn(clock.book, me));
      const r = await plannedForMe({ callSkill, me });
      // the device's own zone (the line builder's default)
      setPlanned(plannedLines(r.items, { t, lang: lang() }));
    } catch { setPlanned([]); }
  }, [callSkill]);

  useEffect(() => { load(); }, [load]);

  const saveIdentity = useCallback(async () => {
    setBusy(true);
    try {
      if (handle && handle !== profile.handle) await callSkill('stoop', 'setMyHandle', { handle: handle.trim() });
      if (display !== (profile.displayName ?? '')) await callSkill('stoop', 'setMyDisplayName', { displayName: display.trim() });
    } catch { /* surfaced on reload */ }
    setBusy(false); load();
  }, [handle, display, profile, callSkill, load]);

  const addOffering = useCallback(async (categoryId) => { try { await callSkill('stoop', 'addMyOffering', { categoryId }); } catch { /* */ } load(); }, [callSkill, load]);
  const removeOffering = useCallback(async (categoryId) => { try { await callSkill('stoop', 'removeMyOffering', { categoryId }); } catch { /* */ } load(); }, [callSkill, load]);
  const geocode = useCallback(async () => {
    const q = geoQuery.trim(); if (!q) return;
    try { const r = await callSkill('stoop', 'geocode', { query: q }); setGeoResult(r?.error ? null : r); } catch { setGeoResult(null); }
  }, [geoQuery, callSkill]);
  const saveLocation = useCallback(async () => {
    if (!geoResult) return;
    try { await callSkill('stoop', 'setMyLocation', { cell: geoResult.cell, label: geoResult.label, source: 'geocode' }); } catch { /* */ }
    setGeoResult(null); setGeoQuery(''); load();
  }, [geoResult, callSkill, load]);
  const clearLocation = useCallback(async () => { try { await callSkill('stoop', 'clearMyLocation', {}); } catch { /* */ } load(); }, [callSkill, load]);

  // Read-accept: prefer the new `offerings` field, fall back to legacy `skills`.
  const myOfferings = Array.isArray(profile.offerings) ? profile.offerings
    : (Array.isArray(profile.skills) ? profile.skills : []);
  const myIds = new Set(myOfferings.map((s) => s.categoryId));
  const catLabel = (id) => categories.find((c) => c.id === id)?.label ?? id;

  return (
    <View style={styles.wrap}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="circle-profile">
      <Text style={styles.title}>{t('circle.profile.title')}</Text>

      <Section title={t('circle.profile.identity')}>
        <Field label={t('circle.profile.handle')} value={handle} onChangeText={setHandle} editable={profileLoaded} testID="profile-handle" />
        <Field label={t('circle.profile.displayName')} value={display} onChangeText={setDisplay} editable={profileLoaded} testID="profile-display" />
        <Pressable
          style={[styles.primary, (!profileLoaded || busy) && styles.primaryDisabled]}
          onPress={saveIdentity} disabled={!profileLoaded || busy}
          accessibilityState={{ disabled: !profileLoaded || busy }} testID="profile-save"
        ><Text style={styles.primaryText}>{t('circle.profile.save')}</Text></Pressable>
      </Section>

      {/* Fold-in phase C (web parity, circleProfile.js) — quiet pointer to the
          "Mij → persona's" surface where offerings live now. The legacy editor
          below stays functional on mobile until the fold-in completes here. */}
      {typeof onOpenMij === 'function' ? (
        <Pressable onPress={onOpenMij} accessibilityRole="button" testID="profile-offerings-moved">
          <Text style={styles.offeringsMoved}>{t('circle.profile.offerings_moved')}</Text>
        </Pressable>
      ) : (
        <Text style={styles.offeringsMoved} testID="profile-offerings-moved">{t('circle.profile.offerings_moved')}</Text>
      )}

      <Section title={t('circle.profile.offerings')}>
        {myOfferings.length === 0 ? <Text style={styles.muted}>{t('circle.profile.no_offerings')}</Text> : (
          <View style={styles.chips}>
            {myOfferings.map((s) => (
              <Pressable key={s.categoryId} style={styles.offeringChip} onPress={() => removeOffering(s.categoryId)} testID={`profile-offering-${s.categoryId}`}>
                <Text style={styles.offeringChipText}>{catLabel(s.categoryId)} ✕</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={styles.muted}>{t('circle.profile.pick_offering')}</Text>
        <View style={styles.chips}>
          {categories.filter((c) => !myIds.has(c.id)).map((c) => (
            <Pressable key={c.id} style={styles.catChip} onPress={() => addOffering(c.id)} testID={`profile-cat-${c.id}`}>
              <Text style={styles.catChipText}>+ {c.label}</Text>
            </Pressable>
          ))}
        </View>
      </Section>

      {/* Mijn overzicht — ONE section (web: circleProfile.js): Gepland's rows on top with the week-overview switch beside
          them, then "Mijn dingen" (my chores across every circle, the shared block). Read-only, no screens manager. */}
      <Section title={t(MIJ_OVERVIEW_TITLE_KEY)}>
        {planned === null || planned.length === 0
          ? <Text style={styles.muted} testID="profile-planned-empty">{t(planned === null ? 'circle.profile.planned_loading' : 'circle.profile.planned_none')}</Text>
          : planned.map((line, i) => <Text key={`${i}-${line}`} style={styles.plannedItem} testID="profile-planned-item">{line}</Text>)}
        {weekOn !== undefined ? (
          <View style={styles.weekRow}>
            {/* The label wraps; the switch keeps its place on the screen (a long label pushed it off the edge). */}
            <Text style={[styles.muted, styles.weekLabel]}>{t('circle.profile.week_switch')}</Text>
            <Pressable
              testID="profile-week-toggle"
              accessibilityRole="switch"
              accessibilityState={{ checked: weekOn === true, disabled: weekOn === null }}
              disabled={weekOn === null}
              onPress={async () => {
                const clock = personClock ? await personClock : null;
                if (!clock || !meRef.current) return;
                const next = !personWeekOn(clock.book, meRef.current);
                setWeekOn(null);
                try { await switchPersonWeek(clock.book, meRef.current, next); } catch { /* shown as it stands below */ }
                setWeekOn(personWeekOn(clock.book, meRef.current));
              }}
              style={styles.weekToggle}
            >
              <Text style={styles.weekToggleText}>{t(weekOn ? 'circle.profile.week_on' : 'circle.profile.week_off')}</Text>
            </Pressable>
          </View>
        ) : null}
        <View testID="profile-overview"><CircleScreenView blocks={overview} /></View>
      </Section>

      <Section title={t('circle.profile.location')}>
        <Text style={styles.locCurrent}>{profile.location?.label ? t('circle.profile.loc_current', { label: profile.location.label }) : t('circle.profile.loc_none')}</Text>
        <View style={styles.row}>
          <TextInput style={styles.input} value={geoQuery} onChangeText={setGeoQuery} placeholder={t('circle.profile.geo_placeholder')} placeholderTextColor={theme.color.inkSoft} testID="profile-geo" />
          <Pressable style={styles.primary} onPress={geocode}><Text style={styles.primaryText}>{t('circle.profile.geo_search')}</Text></Pressable>
        </View>
        {geoResult?.label && (
          <View style={styles.row}>
            <Text style={styles.locResult}>{geoResult.label}</Text>
            <Pressable style={styles.primary} onPress={saveLocation}><Text style={styles.primaryText}>{t('circle.profile.geo_use')}</Text></Pressable>
          </View>
        )}
        {profile.location?.label && <Pressable style={styles.secondary} onPress={clearLocation}><Text style={styles.secondaryText}>{t('circle.profile.loc_clear')}</Text></Pressable>}
        {/* The geo editor sets the coarse place; WHO sees it is a disclosure on the persona layer.
            A quiet pointer, exactly as web has had — mobile was missing it entirely. */}
        {typeof onOpenMij === 'function' ? (
          <Pressable onPress={onOpenMij} accessibilityRole="button" testID="profile-loc-disclosure">
            <Text style={styles.offeringsMoved}>{t('circle.profile.loc_disclosure_hint')}</Text>
          </Pressable>
        ) : (
          <Text style={styles.offeringsMoved} testID="profile-loc-disclosure">{t('circle.profile.loc_disclosure_hint')}</Text>
        )}
      </Section>

      {/* Share my contact (web parity with circleProfile.js, 2026-09-19): the QR, the code, the link. */}
      {typeof onShareContact === 'function' && (
        <Pressable style={styles.secondary} onPress={onShareContact} testID="profile-share-contact"><Text style={styles.secondaryText}>{t('circle.profile.share_contact')}</Text></Pressable>
      )}
      {typeof onAvailability === 'function' && (
        <Pressable style={styles.secondary} onPress={onAvailability} testID="profile-availability"><Text style={styles.secondaryText}>{t('circle.profile.availability')}</Text></Pressable>
      )}
      {typeof onMyData === 'function' && (
        <Pressable style={styles.secondary} onPress={onMyData} testID="profile-mydata"><Text style={styles.secondaryText}>{t('circle.profile.mydata')}</Text></Pressable>
      )}
      {typeof onSharedWithMe === 'function' && (
        <Pressable style={styles.secondary} onPress={onSharedWithMe} testID="profile-shared-with-me"><Text style={styles.secondaryText}>{t('circle.profile.sharedWithMe')}</Text></Pressable>
      )}
      {typeof onBlocked === 'function' && (
        <Pressable style={styles.secondary} onPress={onBlocked} testID="profile-blocked"><Text style={styles.secondaryText}>{t('circle.profile.blocked')}</Text></Pressable>
      )}
      {typeof onAdvanced === 'function' && (
        <Pressable style={styles.secondary} onPress={onAdvanced} testID="profile-advanced"><Text style={styles.secondaryText}>{t('circle.advanced.title')}</Text></Pressable>
      )}
      {busy && <Text style={styles.muted}>{t('circle.profile.saving')}</Text>}
    </ScrollView>
    </View>
  );
}

function Section({ title, children }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function Field({ label, value, onChangeText, editable = true, testID }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={[styles.input, !editable && styles.inputWaiting]} value={value} onChangeText={onChangeText} editable={editable} autoCapitalize="none" testID={testID} />
    </View>
  );
}

const makeStyles = (theme, insets) => StyleSheet.create({
  wrap: { flex: 1, paddingTop: insets?.top ?? 0, backgroundColor: theme.color.paper },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 80 },
  title: { fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink },
  section: { borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, padding: 12, gap: 10, backgroundColor: theme.color.paper },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: theme.color.inkSoft },
  field: { gap: 4 },
  fieldLabel: { fontSize: 13, color: theme.color.inkSoft },
  input: { flex: 1, fontSize: 14, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  primary: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center', alignSelf: 'flex-start' },
  primaryDisabled: { opacity: 0.4 },
  inputWaiting: { opacity: 0.5 },
  primaryText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  secondary: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.accent, alignSelf: 'flex-start' },
  secondaryText: { fontSize: 14, fontWeight: '600', color: theme.color.accent },
  muted: { fontSize: 13, color: theme.color.inkSoft },
  // The two pointers into personas are LINKS (they open Me → personas) — painted as links, not as footnotes.
  offeringsMoved: { fontSize: 13.5, fontWeight: '600', color: theme.color.accent, textDecorationLine: 'underline' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  offeringChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.color.line },
  offeringChipText: { fontSize: 13, color: theme.color.ink },
  catChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.color.accent },
  catChipText: { fontSize: 13, color: theme.color.accent },
  locCurrent: { fontSize: 14, color: theme.color.ink },
  plannedItem: { fontSize: 14, color: theme.color.ink },
  weekRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8 },
  weekLabel: { flex: 1 },
  weekToggle: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: theme.radius ?? 6, borderWidth: 1, borderColor: theme.color.ink },
  weekToggleText: { fontSize: 13, fontWeight: '600', color: theme.color.ink },
  locResult: { flex: 1, fontSize: 14, color: theme.color.ink },
});
