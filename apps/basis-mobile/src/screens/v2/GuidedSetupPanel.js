/**
 * basis-mobile v2 — guided-setup chatbot panel (Theme B, mobile parity).
 *
 * RN counterpart of web's `guidedSetupPanel.renderGuidedSetup` over the SAME
 * shared engine (`src/v2/guidedSetup.js`): a Modal that walks ONE step of a
 * template-driven setup flow (the bot's line + the answer affordance —
 * choice buttons / multiselect + Continue / a plain Continue for statements).
 *
 * The host (CircleSettingsScreen) owns nothing but open/close + the onDone
 * hand-off: this panel runs the flow internally (startGuidedSetup →
 * submitGuidedStep) and, when the flow ends, calls onDone(guidedPolicyPatch)
 * so the settings form is pre-filled (the GUI hand-off). The template can be
 * HQ-updated remotely (loadSettingsTemplate), with the bundled default as the
 * offline fallback. Template content carries its own copy; the chrome
 * (Continue / Skip / Open settings) stays localized via t().
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { t as defaultT } from '../../core/localisation.js';
import {
  DEFAULT_SETTINGS_TEMPLATE,
  loadSettingsTemplate,
  startGuidedSetup,
  stepOf,
  submitGuidedStep,
  guidedPolicyPatch,
} from '../../../../basis/src/v2/guidedSetup.js';

export default function GuidedSetupPanel({
  visible,
  template: templateProp,
  templateUrl,
  t = defaultT,
  onDone,
  onClose,
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [template, setTemplate] = useState(templateProp || DEFAULT_SETTINGS_TEMPLATE);
  const [state, setState] = useState(() => startGuidedSetup(templateProp || DEFAULT_SETTINGS_TEMPLATE));
  // multiselect checkbox state for the current step (reset on each step).
  const [checked, setChecked] = useState({});

  // When opened, (re)load the template (remote → fallback) and start fresh.
  useEffect(() => {
    if (!visible) return;
    let live = true;
    const begin = (tpl) => {
      if (!live) return;
      setTemplate(tpl);
      setState(startGuidedSetup(tpl));
      setChecked({});
    };
    if (templateProp) { begin(templateProp); return () => { live = false; }; }
    loadSettingsTemplate({ url: templateUrl }).then(begin).catch(() => begin(DEFAULT_SETTINGS_TEMPLATE));
    return () => { live = false; };
  }, [visible, templateProp, templateUrl]);

  const close = (extra) => { try { onClose?.(extra); } catch { /* */ } };

  const answer = (value) => {
    const r = submitGuidedStep(template, state, value);
    setChecked({});
    if (r.done) {
      try { onDone?.(guidedPolicyPatch(r.state)); } catch { /* defensive */ }
      close({ handoff: r.handoff });
      return;
    }
    setState(r.state);
  };

  const step = template ? stepOf(template, state) : null;

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={() => close({ handoff: false })}>
      <View style={styles.overlay}>
        <View style={styles.card} testID="guided-setup">
          <View style={styles.head}>
            <Text style={styles.title}>{t('circle.guided.title')}</Text>
            <Pressable
              onPress={() => close({ handoff: false })}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              testID="guided-close"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          {!step ? (
            <Text style={styles.say} testID="guided-done">{t('circle.guided.applied')}</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.body}>
              <Text style={styles.say} testID="guided-say">{step.say ?? step.ask ?? ''}</Text>

              {step.ask ? (
                step.kind === 'multiselect' ? (
                  <>
                    {(Array.isArray(step.options) ? step.options : []).map((opt) => {
                      const on = !!checked[opt.value];
                      return (
                        <Pressable
                          key={opt.value}
                          style={[styles.opt, on && styles.optOn]}
                          onPress={() => setChecked((c) => ({ ...c, [opt.value]: !c[opt.value] }))}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          testID={`guided-opt-${opt.value}`}
                        >
                          <View style={[styles.box, on && styles.boxOn]}>{on ? <Text style={styles.tick}>✓</Text> : null}</View>
                          <Text style={styles.optLabel}>{opt.label ?? opt.value}</Text>
                        </Pressable>
                      );
                    })}
                    <Pressable
                      style={styles.primary}
                      onPress={() => answer(Object.keys(checked).filter((k) => checked[k]))}
                      accessibilityRole="button"
                      testID="guided-continue"
                    >
                      <Text style={styles.primaryText}>{t('circle.guided.continue')}</Text>
                    </Pressable>
                    <Pressable style={styles.secondary} onPress={() => answer(undefined)} accessibilityRole="button" testID="guided-skip">
                      <Text style={styles.secondaryText}>{t('circle.guided.skip')}</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    {(Array.isArray(step.options) ? step.options : []).map((opt) => (
                      <Pressable
                        key={opt.value}
                        style={styles.choice}
                        onPress={() => answer(opt.value)}
                        accessibilityRole="button"
                        testID={`guided-opt-${opt.value}`}
                      >
                        <Text style={styles.choiceText}>{opt.label ?? opt.value}</Text>
                      </Pressable>
                    ))}
                    <Pressable style={styles.secondary} onPress={() => answer(undefined)} accessibilityRole="button" testID="guided-skip">
                      <Text style={styles.secondaryText}>{t('circle.guided.skip')}</Text>
                    </Pressable>
                  </>
                )
              ) : (
                <Pressable style={styles.primary} onPress={() => answer(undefined)} accessibilityRole="button" testID="guided-continue">
                  <Text style={styles.primaryText}>
                    {t(step.handoff ? 'circle.guided.open_settings' : 'circle.guided.continue')}
                  </Text>
                </Pressable>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 18 },
  card:         { backgroundColor: theme.color.paper, borderRadius: theme.radius.md, padding: 18, maxHeight: '80%' },
  head:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title:        { fontSize: 18, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink },
  close:        { fontSize: 18, color: theme.color.inkSoft },
  body:         { paddingBottom: 6 },
  say:          { fontSize: 15, color: theme.color.ink, lineHeight: 21, marginBottom: 14 },
  // multiselect option (checkbox row).
  opt:          { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, paddingVertical: 11, paddingHorizontal: 12, marginBottom: 8 },
  optOn:        { borderColor: theme.color.accent, backgroundColor: theme.color.card },
  box:          { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: theme.color.line, marginRight: 11, alignItems: 'center', justifyContent: 'center' },
  boxOn:        { borderColor: theme.color.accent, backgroundColor: theme.color.accent },
  tick:         { fontSize: 12, color: theme.color.white, fontWeight: '700' },
  optLabel:     { fontSize: 14, color: theme.color.ink, flexShrink: 1 },
  // choice option (single-tap button).
  choice:       { borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8 },
  choiceText:   { fontSize: 14, color: theme.color.ink },
  primary:      { marginTop: 6, padding: 13, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  primaryText:  { color: theme.color.white, fontSize: 15, fontWeight: '700' },
  secondary:    { marginTop: 8, padding: 10, alignItems: 'center' },
  secondaryText:{ color: theme.color.inkSoft, fontSize: 13 },
});
