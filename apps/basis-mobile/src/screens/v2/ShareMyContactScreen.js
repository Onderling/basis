/**
 * basis-mobile v2 — Share my contact (a Mij sub-screen; web parity with `web/v2/shareMyContact.js`, 2026-09-19).
 *
 * This person's contact three ways: a QR for a camera in the room, the raw `onderling-contact://` code, and the
 * LINK — the hosted web app's URL with the card in the fragment, which adds the contact when opened (web's boot
 * and this app's link receiver both read it through the one `contactCardFromLink`). The phone's own way to hand
 * a link over is the share sheet, so that is the one button. Paint only: the shared `loadShareMyContact`
 * resolves the card and the link; a missing card is said, not guessed.
 *
 * The link needs to know where the web app lives — `EXPO_PUBLIC_WEB_APP_URL` (e.g. https://onderling.org/basis/).
 * Unset ⇒ no link row; the QR and the code still stand.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Share } from 'react-native';
import { QrCodeView } from '@onderling/react-native/qr/view';
import { loadShareMyContact } from '../../../../basis/src/v2/contactCardLink.js';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';

export const WEB_APP_URL = process.env.EXPO_PUBLIC_WEB_APP_URL || null;

export default function ShareMyContactScreen({ callSkill, onBack, appUrl = WEB_APP_URL }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [state, setState] = useState({ loading: true, payload: null, link: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = typeof callSkill === 'function' ? await loadShareMyContact({ callSkill, appUrl }) : { payload: null, link: null };
      if (alive) setState({ loading: false, ...r });
    })();
    return () => { alive = false; };
  }, [callSkill, appUrl]);

  const share = () => {
    const message = state.link ?? state.payload;
    if (message) Share.share({ message }).catch(() => { /* the sheet was dismissed */ });
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} testID="share-my-contact-screen">
      <Pressable onPress={onBack} accessibilityRole="button" testID="share-contact-back">
        <Text style={styles.back}>{t('circle.shareContact.back')}</Text>
      </Pressable>
      <Text style={styles.title}>{t('circle.shareContact.title')}</Text>
      {state.loading ? (
        <Text style={styles.muted}>{t('circle.loading')}</Text>
      ) : !state.payload ? (
        <Text style={styles.error} testID="share-contact-error">{t('circle.shareContact.error')}</Text>
      ) : (
        <View>
          <Text style={styles.note}>{t('circle.shareContact.hint')}</Text>
          <View style={styles.qrBox} testID="share-contact-qr">
            <QrCodeView value={state.payload} size={220} />
          </View>
          <Text style={styles.label}>{t('circle.shareContact.code_label')}</Text>
          <Text style={styles.value} selectable numberOfLines={3} testID="share-contact-code">{state.payload}</Text>
          {state.link ? (
            <View>
              <Text style={styles.label}>{t('circle.shareContact.link_label')}</Text>
              <Text style={styles.value} selectable numberOfLines={3} testID="share-contact-link">{state.link}</Text>
            </View>
          ) : null}
          <Pressable style={styles.button} onPress={share} accessibilityRole="button" testID="share-contact-share">
            <Text style={styles.buttonText}>{t('circle.shareContact.share')}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap:       { flex: 1, backgroundColor: theme.color.paper },
  content:    { padding: 16, paddingBottom: 48 },
  back:       { fontSize: 15, color: theme.color.accent, marginBottom: 10 },
  title:      { fontSize: 20, fontWeight: '700', color: theme.color.ink, marginBottom: 6 },
  note:       { fontSize: 13, color: theme.color.inkSoft, marginBottom: 12 },
  muted:      { fontSize: 14, color: theme.color.inkSoft },
  error:      { fontSize: 14, color: theme.color.danger },
  qrBox:      { alignSelf: 'flex-start', padding: 8, backgroundColor: theme.color.white, borderRadius: 8, marginBottom: 12 },   // white behind the QR: scanner contrast
  label:      { fontSize: 12, color: theme.color.inkSoft, marginTop: 8 },
  value:      { fontFamily: 'monospace', fontSize: 12, color: theme.color.ink, marginTop: 2 },
  button:     { marginTop: 16, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.color.accent },
  buttonText: { fontSize: 14, fontWeight: '600', color: theme.color.accentContrast },
});
