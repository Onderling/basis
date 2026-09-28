/**
 * basis-mobile v2 — recipe conflict resolver modal (γ.3 / Phase 9).
 *
 * RN counterpart of web's `recipeConflictResolver.js`.  Uses the same
 * substrate (`detectRecipeConflicts` / `applyResolution`) and exposes
 * the same per-block + per-meta picker UI in a RN <Modal> sheet with
 * a tap-outside-dismiss backdrop (mirrors β.5's per-tile context menu
 * pattern in CircleLauncherScreen).
 *
 * Pure controlled component: host owns the conflicts shape + the local
 * and incoming recipes; this screen calls `onResolve(decisions)` /
 * `onCancel()` and lets the host run `applyResolution` + persist.
 *
 * γ.4 — the modal is reused for the rules doc and the circle policy:
 * those shapes have no `blocks` array, so detection produces only
 * `metaConflicts`.  The `title` prop lets the host override the
 * heading translation key (`circle.rules.conflict.title`) while every other locale key stays
 * under `circle.recipe.conflict.*` — the picker copy is identical.
 */
import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Modal, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';
import { BLOCK_REGISTRY } from '@onderling-app/basis';

/**
 * @param {object} props
 * @param {boolean} props.visible
 * @param {{ blockConflicts, metaConflicts, identical, toMerge }} props.conflicts
 * @param {object} props.local
 * @param {object} props.incoming
 * @param {(decisions: Record<string,string>) => void} props.onResolve
 * @param {() => void} props.onCancel
 * @param {string|null} [props.title=null]  γ.4 — translation key for the
 *        modal heading.  Defaults to `circle.recipe.conflict.title` for
 *        backwards compatibility with every γ.3 caller.
 */
export default function CircleRecipeConflictScreen({
  visible = true,
  conflicts,
  local,
  incoming,
  onResolve,
  onCancel,
  title = null,
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [blockDecisions, setBlockDecisions] = useState({});
  const [metaDecisions, setMetaDecisions]   = useState({});

  const blockConflicts = Array.isArray(conflicts?.blockConflicts) ? conflicts.blockConflicts : [];
  const metaConflicts  = Array.isArray(conflicts?.metaConflicts)  ? conflicts.metaConflicts  : [];

  const lBlockMap = useMemo(() => {
    const arr = Array.isArray(local?.blocks) ? local.blocks : [];
    return new Map(arr.map((b) => [b?.id, b]));
  }, [local]);
  const iBlockMap = useMemo(() => {
    const arr = Array.isArray(incoming?.blocks) ? incoming.blocks : [];
    return new Map(arr.map((b) => [b?.id, b]));
  }, [incoming]);

  const allBlocksPicked = blockConflicts.every((bc) => !!blockDecisions[bc.blockId]);
  const allMetaPicked = metaConflicts.every((mc) => {
    const k = Array.isArray(mc.path) ? mc.path.join('.') : String(mc.path ?? '');
    return !!metaDecisions[k];
  });
  const canApply = allBlocksPicked && allMetaPicked;

  const handleApply = () => {
    if (!canApply) return;
    const merged = { ...blockDecisions, ...metaDecisions };
    onResolve?.(merged);
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} testID="recipe-conflict-backdrop">
        {/* Inner Pressable swallows taps so the sheet doesn't dismiss itself. */}
        <Pressable style={styles.sheet} onPress={() => {}} testID="recipe-conflict-sheet">
          <Text style={styles.title}>{t(typeof title === 'string' && title ? title : 'circle.recipe.conflict.title')}</Text>
          <Text style={styles.instructions}>{t('circle.recipe.conflict.instructions')}</Text>

          <ScrollView contentContainerStyle={styles.body}>
            {blockConflicts.map((bc) => {
              const ref = lBlockMap.get(bc.blockId) ?? iBlockMap.get(bc.blockId);
              const type = ref?.type ?? 'unknown';
              const meta = BLOCK_REGISTRY[type];
              const emoji = meta?.emoji ? `${meta.emoji} ` : '';
              const typeLabel = t(`circle.recipe.block.${type}`);
              const label = t('circle.recipe.conflict.block_label', { name: `${emoji}${typeLabel}` });
              const pick = blockDecisions[bc.blockId];
              return (
                <View key={`block-${bc.blockId}`} style={styles.row} testID={`recipe-conflict-block-${bc.blockId}`}>
                  <Text style={styles.rowLabel}>{label}</Text>
                  <View style={styles.picker}>
                    {['yours', 'theirs', 'both'].map((choice) => (
                      <Pressable
                        key={choice}
                        style={[styles.choice, pick === choice && styles.choicePicked]}
                        onPress={() => setBlockDecisions((d) => ({ ...d, [bc.blockId]: choice }))}
                        accessibilityRole="button"
                        accessibilityState={{ selected: pick === choice }}
                        testID={`recipe-conflict-block-${bc.blockId}-${choice}`}
                      >
                        <Text style={[styles.choiceText, pick === choice && styles.choiceTextPicked]}>
                          {choice === 'yours'  ? t('circle.recipe.conflict.keep_yours')
                          : choice === 'theirs' ? t('circle.recipe.conflict.take_theirs')
                          :                       t('circle.recipe.conflict.keep_both')}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}

            {metaConflicts.length > 0 ? (
              <Text style={styles.metaHeader}>{t('circle.recipe.conflict.meta_section')}</Text>
            ) : null}
            {metaConflicts.map((mc) => {
              const pathKey = Array.isArray(mc.path) ? mc.path.join('.') : String(mc.path ?? '');
              const pick = metaDecisions[pathKey];
              return (
                <View key={`meta-${pathKey}`} style={styles.row} testID={`recipe-conflict-meta-${pathKey}`}>
                  <Text style={styles.rowLabel}>
                    {t('circle.recipe.conflict.meta_label', { path: pathKey })}
                  </Text>
                  <Text style={styles.preview}>
                    {`${t('circle.recipe.conflict.keep_yours')}: ${formatPreview(mc.yours)} · `
                      + `${t('circle.recipe.conflict.take_theirs')}: ${formatPreview(mc.theirs)}`}
                  </Text>
                  <View style={styles.picker}>
                    {['yours', 'theirs'].map((choice) => (
                      <Pressable
                        key={choice}
                        style={[styles.choice, pick === choice && styles.choicePicked]}
                        onPress={() => setMetaDecisions((d) => ({ ...d, [pathKey]: choice }))}
                        accessibilityRole="button"
                        accessibilityState={{ selected: pick === choice }}
                        testID={`recipe-conflict-meta-${pathKey}-${choice}`}
                      >
                        <Text style={[styles.choiceText, pick === choice && styles.choiceTextPicked]}>
                          {choice === 'yours'
                            ? t('circle.recipe.conflict.keep_yours')
                            : t('circle.recipe.conflict.take_theirs')}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={styles.cancel}
              onPress={onCancel}
              accessibilityRole="button"
              testID="recipe-conflict-cancel"
            >
              <Text style={styles.cancelText}>{t('circle.recipe.conflict.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.apply, !canApply && styles.applyDisabled]}
              disabled={!canApply}
              onPress={handleApply}
              accessibilityRole="button"
              testID="recipe-conflict-apply"
            >
              <Text style={[styles.applyText, !canApply && styles.applyTextDisabled]}>
                {t('circle.recipe.conflict.apply')}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function formatPreview(v) {
  if (v == null) return '—';
  if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
  } catch { return String(v); }
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet:      { backgroundColor: theme.color.card, borderColor: theme.color.line, borderWidth: 1, borderRadius: 10, padding: 18, maxWidth: 560, width: '100%', maxHeight: '85%' },
  title:      { fontSize: 18, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginBottom: 4 },
  instructions:{ fontSize: 13, color: theme.color.inkSoft, marginBottom: 14 },
  body:       { paddingBottom: 12 },
  row:        { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  rowLabel:   { fontWeight: '600', fontSize: 14, color: theme.color.ink, marginBottom: 6 },
  preview:    { fontSize: 12, color: theme.color.inkSoft, marginBottom: 6 },
  picker:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice:     { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: theme.color.line, borderRadius: 6, backgroundColor: theme.color.card },
  choicePicked:{ backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  choiceText: { fontSize: 13, color: theme.color.ink },
  choiceTextPicked:{ color: theme.color.white, fontWeight: '600' },
  metaHeader: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: theme.color.inkSoft, marginTop: 12, marginBottom: 4 },
  footer:     { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.color.line },
  cancel:     { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8 },
  cancelText: { fontSize: 14, color: theme.color.ink },
  apply:      { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.color.accent, borderRadius: 8 },
  applyDisabled:{ backgroundColor: theme.color.paper2, opacity: 0.6 },
  applyText:  { fontSize: 14, color: theme.color.white, fontWeight: '600' },
  applyTextDisabled:{ color: theme.color.inkSoft },
});
