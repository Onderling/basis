/**
 * RecipeConsentCard — the REVIEWED apply-recipe surface (B · consent-card tail, RN).
 *
 * RN twin of web's `recipeConsentCard.js`. Renders the platform-neutral review model from the shared
 * `buildRecipeConsentModel` (invariants #1/#2 — the model is built ONCE in basis `src/`): what the
 * recipe would ENABLE (capabilities + features + settings) and, for the OPT-OUTABLE caps, a Switch per cap
 * so the user can decline the optional ones — then resolves Agree / Decline.
 *
 *   - Decline → `onDecline()` (nothing is applied).
 *   - Agree   → `onAgree({ declinedKeys })` where `declinedKeys` are the opt-outable caps switched OFF.
 *
 * The card renders NO recipe/consent logic: Agree flows through the caller's `applyReviewedRecipe`. Every
 * string via `t()` (the shared `circle.recipeConsent.*` locale keys the web card added). Mirrors the
 * `<Modal transparent>` pattern of ExtensionConsentSheet.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, Switch, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';
import { declinedKeysFrom } from '../../core/recipeConsentWiring.js';

/** Localised atom verb label, falling back to the atom when no key is translated (t() echoes on a miss). */
function verbLabel(atom) {
  const k = `circle.settings.verb.${atom}`;
  const v = t(k);
  return v && v !== k ? v : atom;
}
function capLabel(cap) {
  return `${verbLabel(cap.atom)} · ${cap.noun}`;
}

export default function RecipeConsentCard({ model, visible, onAgree, onDecline }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const optItems = Array.isArray(model?.consent?.items) ? model.consent.items : [];
  // Per-cap keep-on switch state (default on; a pre-declined cap starts off) — reset whenever a new model opens.
  const [checked, setChecked] = useState({});
  useEffect(() => {
    const init = {};
    for (const i of optItems) init[i.key] = !i.optedOut;
    setChecked(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  if (!visible || !model) return null;

  const caps = Array.isArray(model?.enabledCaps) ? model.enabledCaps : [];
  const features = Array.isArray(model?.features) ? model.features : [];
  const settings = Array.isArray(model?.settings) ? model.settings : [];
  const optKeys = new Set(optItems.map((i) => i.key));
  // Mandatory (non-opt-outable) caps render as plain rows; the opt-outable ones get a switch below.
  const mandatoryCaps = caps.filter((c) => !optKeys.has(c.key));

  const agree = () => onAgree?.({ declinedKeys: declinedKeysFrom(optItems, checked) });

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onDecline}>
      <Pressable style={styles.backdrop} onPress={onDecline} testID="recipe-consent-backdrop">
        <Pressable style={styles.sheet} onPress={() => {}} testID="recipe-consent-card">
          <Text style={styles.title}>{t('circle.recipeConsent.title')}</Text>
          <Text style={styles.intro}>{t('circle.recipeConsent.intro')}</Text>

          <ScrollView contentContainerStyle={styles.body}>
            {(mandatoryCaps.length || features.length || settings.length) ? (
              <>
                <Text style={styles.label}>{t('circle.recipeConsent.enables')}</Text>
                {mandatoryCaps.map((c) => (
                  <Text key={c.key} style={styles.enableItem} testID={`recipe-consent-cap-${c.key}`}>
                    {`• ${capLabel(c)}`}
                  </Text>
                ))}
                {features.map((f) => (
                  <Text key={f} style={styles.enableItem} testID={`recipe-consent-feature-${f}`}>
                    {`• ${(t(`circle.settings.feat.${f}`) && t(`circle.settings.feat.${f}`) !== `circle.settings.feat.${f}`) ? t(`circle.settings.feat.${f}`) : f}`}
                  </Text>
                ))}
                {settings.map((s) => (
                  <Text key={s.key} style={styles.enableItem} testID={`recipe-consent-setting-${s.key}`}>
                    {`• ${s.key}: ${String(s.value)}`}
                  </Text>
                ))}
              </>
            ) : null}

            {optItems.length ? (
              <>
                <Text style={[styles.label, styles.optionalLabel]}>{t('circle.recipeConsent.optional')}</Text>
                {optItems.map((item) => (
                  <View key={item.key} style={styles.optRow} testID={`recipe-consent-opt-${item.key}`}>
                    <Text style={styles.optLabel}>{capLabel(item)}</Text>
                    <Switch /* sets: form — a capability this consent keeps or declines */
                      trackColor={{ true: theme.color.accent, false: theme.color.trackOff }}
                      thumbColor={theme.color.white}
                      value={checked[item.key] ?? !item.optedOut}
                      onValueChange={(v) => setChecked((c) => ({ ...c, [item.key]: v }))}
                      testID={`recipe-consent-opt-switch-${item.key}`}
                    />
                  </View>
                ))}
                <Text style={styles.hint}>{t('circle.recipeConsent.optional_hint')}</Text>
              </>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable onPress={onDecline} style={styles.decline} testID="recipe-consent-decline">
              <Text style={styles.declineText}>{t('circle.recipeConsent.decline')}</Text>
            </Pressable>
            <Pressable onPress={agree} style={styles.agree} testID="recipe-consent-agree">
              <Text style={styles.agreeText}>{t('circle.recipeConsent.agree')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet:        { backgroundColor: theme.color.paper, borderRadius: theme.radius?.lg ?? 12, padding: 20, width: '100%', maxWidth: 460, maxHeight: '85%' },
  title:        { fontSize: 18, fontWeight: '600', color: theme.color.ink, marginBottom: 6 },
  intro:        { fontSize: 14, color: theme.color.inkSoft, marginBottom: 12 },
  body:         { paddingBottom: 8 },
  label:        { fontWeight: '600', color: theme.color.ink, marginBottom: 4 },
  optionalLabel:{ marginTop: 12 },
  enableItem:   { color: theme.color.ink, marginBottom: 2 },
  optRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  optLabel:     { fontSize: 14, color: theme.color.ink, flexShrink: 1, paddingRight: 8 },
  hint:         { color: theme.color.inkSoft, fontSize: 13, marginTop: 6 },
  actions:      { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  decline:      { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.color.line },
  declineText:  { color: theme.color.ink },
  agree:        { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: theme.color.accent },
  agreeText:    { color: theme.color.white, fontWeight: '600' },
});
