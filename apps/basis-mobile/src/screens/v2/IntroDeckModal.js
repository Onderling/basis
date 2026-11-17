/**
 * THE INTRODUCTION, painted on the phone: one card per screen from the shared model (`basis/src/v2/introDeck.js`),
 * "Next" (the last card: "Get started") and "Skip". Paint only: which card, its words and its buttons come from the
 * model; the host decides what closing means (Today again). Web twin: basis/web/v2/introDeck.js.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import Btn from './Btn.js';
import { useSheetCap, SHEET_SCROLL } from './sheetCap.js';
import { t } from '../../core/localisation.js';
import { introStep, introNext } from '../../../../basis/src/v2/introDeck.js';

export default function IntroDeckModal({ visible = false, onClose } = {}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const sheetCap = useSheetCap(0.85);
  const [index, setIndex] = useState(0);
  // a deck opened again starts at its first card
  useEffect(() => { if (visible) setIndex(0); }, [visible]);
  if (!visible) return null;
  const step = introStep(index);
  const next = () => {
    const n = introNext(index);
    if (n === null) onClose?.(); else setIndex(n);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onClose?.()}>
      <View style={styles.backdrop}>
        <View style={[styles.card, sheetCap]} testID="intro-deck">
          <ScrollView style={SHEET_SCROLL} contentContainerStyle={styles.body}>
            <Text style={styles.position} testID="intro-deck-position">{t('circle.introDeck.position', { at: step.position.at, of: step.position.of })}</Text>
            <Text style={styles.title} testID={`intro-deck-card-${step.id}`}>{t(step.titleKey)}</Text>
            <Text style={styles.text}>{t(step.bodyKey)}</Text>
            <Btn variant="primary" onPress={next} testID="intro-deck-next" label={t(step.nextKey)} style={styles.btnAt} />
            {/* "Skip" under each card but the last (there "Get started" already leaves) */}
            {!step.isLast ? <Btn variant="ghost" onPress={() => onClose?.()} testID="intro-deck-skip" label={t(step.skipKey)} style={styles.btnAt} /> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: theme.color.card, borderRadius: 12, padding: 20 },
  body: { gap: 12 },
  position: { fontSize: 13, color: theme.color.inkSoft },
  title: { fontSize: 20, fontWeight: '700', color: theme.color.ink },
  text: { fontSize: 16, lineHeight: 23, color: theme.color.ink },
  btnAt: { alignSelf: 'flex-start' },
});
