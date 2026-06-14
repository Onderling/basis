/**
 * canopy-chat-mobile v2 — extension consent sheet (feedback-extension P2 mobile parity).
 *
 * RN twin of web's `extensionConsentCard`. Renders a `buildConsentModel` result
 * (shared, tested) as a plain consent sheet: the commands the extension adds +
 * what each invokes + the atoms it needs + scope + "what if I deny?", with
 * Add / Decline. A REFUSED result (the sandbox verifier failed) shows the
 * "capabilities not available here" message + only Decline. All strings via
 * `t('circle.extension.*')` (the shared circle locale). Mirrors the
 * `<Modal transparent>` pattern of CircleCatchUpChooserScreen.
 *
 * @param {{ result: {ok:boolean, missing?:string[], card?:object} | null,
 *           onAdd: () => void, onDecline: () => void }} props
 */
import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import { t } from '../../core/localisation.js';

export default function ExtensionConsentSheet({ result, onAdd, onDecline }) {
  const visible = !!result;
  const ok = !!(result && result.ok);
  const card = ok ? result.card : null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onDecline}>
      <Pressable style={styles.backdrop} onPress={onDecline} testID="ext-consent-backdrop">
        {/* Inner Pressable swallows taps so the sheet doesn't dismiss. */}
        <Pressable style={styles.sheet} onPress={() => {}} testID="ext-consent-sheet">
          {!ok ? (
            <View>
              <Text style={styles.title} testID="ext-consent-refused">
                {t('circle.extension.refused', { missing: (result?.missing ?? []).join(', ') })}
              </Text>
              <View style={styles.actions}>
                <Pressable onPress={onDecline} style={styles.decline} testID="ext-consent-decline">
                  <Text style={styles.declineText}>{t('circle.extension.decline')}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View>
              <Text style={styles.title}>{t('circle.extension.title', { title: card.title })}</Text>
              <ScrollView contentContainerStyle={styles.body}>
                <Text style={styles.label}>{t('circle.extension.adds')}</Text>
                {card.commands.map((c, i) => (
                  <Text key={i} style={styles.cmd} testID={`ext-consent-cmd-${i}`}>
                    {c.invokes.length
                      ? `${c.command} — ${t('circle.extension.invokes', { ops: c.invokes.join(', ') })}`
                      : c.command}
                  </Text>
                ))}
                {card.needs.length > 0 && (
                  <Text style={styles.needs}>{t('circle.extension.needs', { atoms: card.needs.join(', ') })}</Text>
                )}
                <Text style={styles.scope}>
                  {t(card.scope === 'circle' ? 'circle.extension.scope_circle' : 'circle.extension.scope_app')}
                </Text>
                <Text style={styles.deny}>{t('circle.extension.what_if_deny')}</Text>
              </ScrollView>
              <View style={styles.actions}>
                <Pressable onPress={onDecline} style={styles.decline} testID="ext-consent-decline">
                  <Text style={styles.declineText}>{t('circle.extension.decline')}</Text>
                </Pressable>
                <Pressable onPress={onAdd} style={styles.add} testID="ext-consent-add">
                  <Text style={styles.addText}>{t('circle.extension.add')}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet:    { backgroundColor: theme.color.paper, borderRadius: theme.radius?.lg ?? 12, padding: 20, width: '100%', maxWidth: 440, maxHeight: '80%' },
  title:    { fontSize: 18, fontWeight: '600', color: theme.color.ink, marginBottom: 12 },
  body:     { paddingBottom: 8 },
  label:    { fontWeight: '600', color: theme.color.ink, marginBottom: 4 },
  cmd:      { color: theme.color.ink, marginBottom: 2 },
  needs:    { color: theme.color.ink, marginTop: 8 },
  scope:    { color: theme.color.inkSoft, marginTop: 8 },
  deny:     { color: theme.color.inkSoft, fontSize: 13, marginTop: 8 },
  actions:  { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  decline:  { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.color.line },
  declineText: { color: theme.color.ink },
  add:      { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: theme.color.accent },
  addText:  { color: theme.color.white, fontWeight: '600' },
});
