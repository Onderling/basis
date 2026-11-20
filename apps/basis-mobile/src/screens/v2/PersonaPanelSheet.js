/**
 * basis-mobile v2 — the persona panel (RN; web: personaPanel.js): what the persona button opens, over the tab that is
 * showing. Painted from the shared model (`personaPanelModel`): one tab per persona when the device holds several (the
 * general self first, the picked one marked), the "Laat zien als" door (the switcher: which personas the app shows),
 * the availability row (its state in words, a tap to change it) and a close. The short view inside is the declared Me (`CircleProfileScreen`), the same one the web paints. A touch
 * outside the card and the back gesture close it.
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { useSheetCap } from './sheetCap.js';
import { availabilityRow } from '../../../../basis/src/v2/mijWords.js';

export default function PersonaPanelSheet({ visible, model, availability = null, connected = false, onAvailability, onTab, onShowAs, onClose, children }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const sheetCap = useSheetCap(0.85);
  if (!model) return null;
  return (
    <Modal visible={!!visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="persona-panel-outside">
        {/* the card swallows its own touches: only a touch outside it closes */}
        <Pressable style={[styles.card, sheetCap]} onPress={() => {}} testID="persona-panel">
          {model.tabs.length > 0 ? (
            <View style={styles.tabs} accessibilityRole="tablist">
              {model.tabs.map((tab) => (
                <Pressable key={tab.id} onPress={() => onTab?.(tab.id)} accessibilityRole="tab" accessibilityState={{ selected: tab.active }}
                  style={[styles.tab, tab.active && styles.tabActive]} testID={`persona-panel-tab-${tab.id}`}>
                  <Text style={[styles.tabText, tab.active && styles.tabTextActive]}>{tab.nameKey ? t(tab.nameKey) : (tab.name ?? tab.id)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {/* the availability, in words, with the control to change it (the persona button's ring shows it in colour) */}
          {typeof onAvailability === 'function' ? (
            <Pressable onPress={onAvailability} accessibilityRole="button" style={styles.availability} testID="persona-panel-availability">
              <Text style={styles.availabilityText}>{availabilityRow(availability, { connected, t })}</Text>
            </Pressable>
          ) : null}
          <View style={styles.body}>{children}</View>
          <View style={styles.foot}>
            {model.showAs ? (
              <Pressable onPress={onShowAs} accessibilityRole="button" testID="persona-panel-show-as">
                <Text style={styles.footText}>{`${t('circle.switcher.title')} ▸`}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} accessibilityRole="button" testID="persona-panel-close">
              <Text style={styles.footText}>{t('circle.persona_panel.close')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  card: { backgroundColor: theme.color.paper, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 12 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  tab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.line },
  tabActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  tabText: { fontSize: 14, fontWeight: '600', color: theme.color.inkSoft },
  tabTextActive: { color: theme.color.white },
  availability: { paddingHorizontal: 16, paddingVertical: 8 },
  availabilityText: { fontSize: 14, color: theme.color.ink },
  body: { flexShrink: 1 },
  foot: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.color.line },
  footText: { fontSize: 14, fontWeight: '600', color: theme.color.accent },
});
