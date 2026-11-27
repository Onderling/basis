/**
 * RestartRequiredScreen — the phone's stop after an op whose result asks for a restart (a phrase restore, an
 * enrolment, a persona paused, removed or received). The state is the agent's (`onRestartRequired`,
 * basis/src/v2/restartRequired.js): this process is the device's former self, the waist refuses every write, and the
 * phone has no way to restart itself, so this screen covers everything, cannot be dismissed and takes no input. It
 * only says what to do. Android recreating the activity inside the same process mounts it again: the agent still holds
 * the state. Web parity: circleApp's restart stop (it reloads); the box exits for its supervisor.
 */
import React, { useMemo } from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

export default function RestartRequiredScreen({ visible }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  if (!visible) return null;
  return (
    // the back key does not close it (onRequestClose does nothing); the app may still be left, and comes back to it
    <Modal visible transparent={false} animationType="none" onRequestClose={() => {}} statusBarTranslucent>
      <View style={styles.root} testID="restart-required">
        <Text style={styles.title} accessibilityRole="header">{t('circle.restart_required.title')}</Text>
        <Text style={styles.body}>{t('circle.restart_required.body')}</Text>
        <Text style={styles.how}>{t('circle.restart_required.how')}</Text>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: theme.color.paper },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 16, color: theme.color.ink },
  body: { fontSize: 16, lineHeight: 23, marginBottom: 14, color: theme.color.ink },
  how: { fontSize: 15, lineHeight: 21, color: theme.color.inkSoft },
});
