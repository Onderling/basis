/**
 * "Pas aan" — the customise sheet for the active Vandaag page, painted from the shared model (`customiseModel` in
 * basis/src/v2/vandaag.js). Every control reports an act (`onAct(act, args)`); the host turns it into the screen op it
 * is (`customiseOp`) and repaints. Nothing here changes the book itself. Web twin: web/v2/vandaagCustomise.js.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import Btn from './Btn.js';
import { t } from '../../core/localisation.js';
import { sectionsOf } from '../../../../basis/src/v2/screenSections.js';

export default function VandaagCustomiseModal({ visible, model, onAct, onClose }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [name, setName] = useState(model?.pageName ?? '');
  useEffect(() => { setName(model?.pageName ?? ''); }, [model?.pageId, model?.pageName]);
  if (!visible || !model) return null;
  // the page's acts wear the shared button family (Btn), quiet by default
  const ActBtn = ({ label, act, args, disabled = false, testID, variant = 'quiet' }) => (
    <Btn variant={variant} label={label} disabled={disabled} onPress={() => onAct?.(act, args)} testID={testID} />
  );
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* the title and Done on one line, above the scroll: the way out is always in view */}
          <View style={styles.head}>
            <Text style={styles.title}>{t('circle.vandaag.customise_title')}</Text>
            <Btn variant="primary" label={t('circle.vandaag.done')} onPress={onClose} testID="customise-done" />
          </View>
          <ScrollView>
            {/* the sheet's DECLARED sections (`screenSections.js`), in order, each by its id (= testID) */}
            {sectionsOf('vandaagCustomise').map((d) => {
              const PAINT = {
                'customise-blocks': () => (<>
            <Text style={styles.heading}>{t('circle.vandaag.blocks_title')}</Text>
            {model.blocks.map((b) => {
              const base = { pageId: model.pageId, blockId: b.blockId, index: b.index };
              return (
                <View key={b.blockId} style={styles.block} testID={`customise-block-${b.blockId}`}>
                  <Text style={styles.blockName}>{t(b.labelKey)}</Text>
                  <View style={styles.row}>
                    <ActBtn label={t('circle.vandaag.up')} act="up" args={base} disabled={!b.canUp} testID={`customise-up-${b.blockId}`} />
                    <ActBtn label={t('circle.vandaag.down')} act="down" args={base} disabled={!b.canDown} testID={`customise-down-${b.blockId}`} />
                    {/* neutral, not alarm-red: removing a block is undone by Undo */}
                    <ActBtn label={t('circle.vandaag.remove')} act="remove" args={base} testID={`customise-remove-${b.blockId}`} />
                  </View>
                  {/* every control under its heading (the model's), so a row of chips says what it sets */}
                  {b.controls.map((c) => (c.text ? (
                    // labels, typed: "werk, thuis" — applied when the field is left
                    <View key={c.kind}>
                    <Text style={styles.controlTitle}>{t(c.titleKey)}</Text>
                    <LabelsField control={c} styles={styles}
                      onApply={(value) => onAct?.('config', { ...base, kind: c.kind, value })} testID={`customise-labels-${b.blockId}`} />
                    </View>
                  ) : c.multi ? (
                    // the block's own circles: none ticked = all the page's
                    <View key={c.kind}>
                    <Text style={styles.controlTitle}>{t(c.titleKey)}</Text>
                    <View style={styles.row}>
                      {c.options.map((o) => {
                        const on = c.value.includes(o.value);
                        return (
                          <Pressable key={o.value} style={[styles.chip, on && styles.chipOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                            onPress={() => onAct?.('config', { ...base, kind: c.kind, value: on ? c.value.filter((v) => v !== o.value) : [...c.value, o.value] })}
                            testID={`customise-circle-${b.blockId}-${o.value}`}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    </View>
                  ) : (
                    <View key={c.kind}>
                    <Text style={styles.controlTitle}>{t(c.titleKey)}</Text>
                    <View style={styles.row}>
                      {c.options.map((o) => {
                        const on = o.value === c.value;
                        return (
                          <Pressable key={String(o.value)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}
                            onPress={() => onAct?.('config', { ...base, kind: c.kind, value: o.value })}
                            testID={`customise-${c.kind}-${b.blockId}-${o.value}`}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(o.labelKey, o.params)}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    </View>
                  )))}
                </View>
              );
            })}
              </>),
                'customise-add': () => (<>
            <Text style={styles.heading}>{t('circle.vandaag.add_block_title')}</Text>
            {model.addable.map((a) => (
              <Pressable key={a.type} style={styles.addable} onPress={() => onAct?.('add', { pageId: model.pageId, type: a.type })} testID={`customise-add-${a.type}`}>
                <Text style={styles.blockName}>{t(a.labelKey)}</Text>
                <Text style={styles.why}>{t(a.descriptionKey)}</Text>
              </Pressable>
            ))}
              </>),
                'customise-page': () => (<>
            <Text style={styles.heading}>{t('circle.vandaag.page_title')}</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} testID="customise-page-name" />
            <View style={styles.row}>
              <ActBtn label={t('circle.vandaag.rename_page')} act="rename-page" args={{ pageId: model.pageId, name }} />
              <ActBtn label={t('circle.vandaag.add_page')} act="add-page" args={{ name: t('circle.vandaag.new_page_name') }} />
              <ActBtn variant="danger" label={t('circle.vandaag.remove_page')} act="remove-page" args={{ pageId: model.pageId }} disabled={!model.canRemovePage} />
            </View>
              </>),
                'customise-undo': () => (
                  <View style={styles.row}>
                    <ActBtn label={t('circle.vandaag.undo')} act="undo" args={{}} testID="customise-undo" />
                  </View>
                ),
              };
              const el = PAINT[d.id]?.();
              return el ? <View key={d.id} testID={d.id}>{el}</View> : null;
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function LabelsField({ control, styles, onApply, testID }) {
  const [text, setText] = useState(control.value);
  useEffect(() => { setText(control.value); }, [control.value]);
  return (
    <TextInput style={[styles.input, { marginTop: 6 }]} value={text} onChangeText={setText}
      placeholder={t('circle.vandaag.labels_placeholder')} accessibilityLabel={t('circle.vandaag.labels_title')}
      autoCapitalize="none" onEndEditing={() => { if (text !== control.value) onApply(text); }} testID={testID} />
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  card: { backgroundColor: theme.color.card, borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16, maxHeight: '85%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: '700', color: theme.color.ink },
  controlTitle: { fontSize: 12, color: theme.color.inkSoft, marginTop: 8 },
  heading: { fontSize: 14, fontWeight: '600', color: theme.color.inkSoft, marginTop: 12, marginBottom: 6 },
  block: { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, padding: 8, marginBottom: 8 },
  blockName: { fontSize: 14, color: theme.color.ink, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.color.line },
  // the chosen chip filled, not just a darker outline: visibly the one that is on
  chipOn: { borderColor: theme.color.ink, backgroundColor: theme.color.ink },
  chipText: { color: theme.color.ink, fontSize: 12 },
  chipTextOn: { color: theme.color.card },
  addable: { paddingVertical: 6 },
  why: { fontSize: 12, color: theme.color.inkSoft },
  input: { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, padding: 8, color: theme.color.ink },
});
