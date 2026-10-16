/**
 * basis-mobile v2 — Mij (RN; web: circleProfile.js): identity, ONE declared screen.
 *
 * What Me shows is declared in the manifest, never listed here: the Me actions (`meActions` — share my card, scan)
 * and the Me blocks (`meBlocks` — the identity line with the person's name and readings, their agents and devices),
 * filled through the shared `mijScreenBlocks` and painted by the screen block painter. Below them, one door to My
 * data (where the other doors went) and, behind the developer switch, Advanced. The identity fields and the location
 * are in the person's own editor (the identity line's "Edit"); the overview is on Vandaag.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../../core/localisation.js';
import { meActionsMobile } from '../../../../basis/src/v2/meActionProjection.js';
import { basisManifest } from '../../../../basis/src/index.js';
import { mijScreenBlocks } from '../../../../basis/src/v2/mijScreen.js';
import { useTheme } from './themeContext.js';
import CircleScreenView from './CircleScreenView.js';

/**
 * @param {object} p
 * @param {Function} p.callSkill   the targeted 3-arg waist
 * @param {object} [p.sources]   what the blocks read beside the waist: `{ eventLog, circles, seenAt, myRefs,
 *   availabilityStore, relays: () => rows, deviceId: () => id, selfIn: (circleId) => webid }`
 */
export default function CircleProfileScreen({ callSkill, sources = {}, onMyData, onEditMe, onAdvanced, onMeAction }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();   // clear the status bar: the title and scrolled content drew under it
  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);
  const [blocks, setBlocks] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (typeof callSkill !== 'function') return;
      const relays = (() => { try { return sources.relays?.() ?? []; } catch { return []; } })();
      const availability = await Promise.resolve().then(() => sources.availabilityStore?.get?.()).catch(() => null);
      const b = await mijScreenBlocks({ hostOps: {
        callSkill, eventLog: sources.eventLog ?? null, circles: sources.circles ?? [],
        seenAt: sources.seenAt ?? {}, myRefs: sources.myRefs ?? [],
        ...(typeof sources.selfIn === 'function' ? { selfIn: sources.selfIn } : {}),
        ...(sources.mijSelf ? { mijSelf: sources.mijSelf } : {}),
        availability,
        // this device is reachable when it is connected at one of its relays (unknown before the peer is up: no reading)
        online: relays.length ? relays.some((r) => r.connected) : undefined,
        deviceId: (() => { try { return sources.deviceId?.() ?? null; } catch { return null; } })(),
      } }).catch(() => []);
      if (alive) setBlocks(b);
    })();
    return () => { alive = false; };
  }, [callSkill, sources]);

  const onBlockAction = (a) => {
    if (a?.kind === 'edit-me') onEditMe?.();
    else if (a?.kind === 'open-my-data') onMyData?.();
  };
  const hasName = Array.isArray(blocks) && blocks.some((b) => b.type === 'identityLine');

  return (
    <View style={styles.wrap}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="circle-profile">
      {/* while the blocks load: the page's own title, so Me is never untitled */}
      {hasName ? null : <Text style={styles.title}>{t('circle.profile.title')}</Text>}

      <View testID="mij-blocks"><CircleScreenView blocks={blocks} onAction={onBlockAction} /></View>

      {/* The Me actions — painted from the manifest's declaration (`meActions` → `meActionsMobile`), never listed here:
          Share my card, Scan. One prop carries the choice back, like the tab bar's `onSelect`. */}
      {typeof onMeAction === 'function' ? (
        <View style={styles.meActions}>
          {meActionsMobile(basisManifest).map((a, i) => (
            <Pressable key={a.id} style={[i === 0 ? styles.primary : styles.secondary, styles.meAction]} onPress={() => onMeAction(a.id)}
              accessibilityRole="button" testID={`profile-${a.id}`}>
              <Text style={i === 0 ? styles.primaryText : styles.secondaryText}>{t(a.labelKey)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {typeof onMyData === 'function' && (
        <Pressable style={styles.secondary} onPress={onMyData} testID="profile-mydata"><Text style={styles.secondaryText}>{t('circle.profile.mydata')}</Text></Pressable>
      )}
      {typeof onAdvanced === 'function' && (
        <Pressable style={styles.secondary} onPress={onAdvanced} testID="profile-advanced"><Text style={styles.secondaryText}>{t('circle.advanced.title')}</Text></Pressable>
      )}
    </ScrollView>
    </View>
  );
}

const makeStyles = (theme, insets) => StyleSheet.create({
  wrap: { flex: 1, paddingTop: insets?.top ?? 0, backgroundColor: theme.color.paper },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 80 },
  title: { fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink },
  primary: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center', alignSelf: 'flex-start' },
  meActions: { flexDirection: 'row', gap: 10 },
  meAction: { flex: 1, alignItems: 'center', alignSelf: 'auto' },
  primaryText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  secondary: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.accent, alignSelf: 'flex-start' },
  secondaryText: { fontSize: 14, fontWeight: '600', color: theme.color.accent },
});
