/**
 * The header switcher (RN; web twin: web/v2/personaSwitcher.js): which of this device's selves the app shows now.
 * Painted from the shared model (`switcherModel`): one row per self (a tick; the last one on cannot be turned off),
 * "Alle", and each self's own editor. Every act is the op the model compiles (`screen-set-personas`); the host runs it.
 */
import React, { useMemo } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

export default function PersonaSwitcherModal({ visible, model, onAct, onEdit, onClose }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  if (!visible || !model) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="persona-switcher">
          <Text style={styles.title}>{t('circle.switcher.title')}</Text>
          {model.rows.map((row) => (
            <View key={row.id} style={styles.row}>
              <Pressable disabled={!row.canToggle} accessibilityRole="checkbox" accessibilityState={{ checked: row.on, disabled: !row.canToggle }}
                onPress={() => { const op = model.toggle(row.id); if (op) onAct?.(op); }} testID={`persona-switcher-tick-${row.id}`}
                style={[styles.tick, !row.canToggle && styles.disabled]}>
                <Text style={styles.text}>{`${row.on ? '☑' : '☐'} ${row.id === 'default' ? t('circle.switcher.you') : (row.name || row.id)}`}</Text>
              </Pressable>
              <Pressable onPress={() => onEdit?.(row.id)} testID={`persona-switcher-edit-${row.id}`}>
                <Text style={styles.edit}>{`${t('circle.switcher.edit')} ▸`}</Text>
              </Pressable>
            </View>
          ))}
          <Pressable disabled={model.allOn} onPress={() => onAct?.(model.all())} style={[styles.btn, model.allOn && styles.disabled]} testID="persona-switcher-all">
            <Text style={styles.text}>{t('circle.switcher.all')}</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.btn} testID="persona-switcher-close">
            <Text style={styles.text}>{t('circle.vandaag.done')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'flex-end', paddingTop: 56, paddingRight: 12 },
  card: { backgroundColor: theme.color.card, borderRadius: 12, padding: 14, gap: 8, minWidth: 220 },
  title: { fontSize: 15, fontWeight: '700', color: theme.color.ink },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  tick: { paddingVertical: 6 },
  text: { fontSize: 14, color: theme.color.ink },
  edit: { fontSize: 13, color: theme.color.accent },
  btn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.color.line, alignSelf: 'flex-start' },
  disabled: { opacity: 0.4 },
});
