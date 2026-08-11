/**
 * CircleRecordScreen — RN renderer for a `shape:'record'` manifest view
 * e.g. the agents app's read-only `agent-detail` (`viewAgent` +
 * `argsFromContext: {agentId: '$agentId'}`).  Twin of web's
 * `web/v2/recordScreen.js`.
 *
 * RN-only glue (invariant #1): the record itself is extracted from the
 * skill reply by shared `recordFromReply` and formatted by the portable
 * `recordFields` model (src/core/screenPanelDrilldown.js); this component
 * just lays the key→value pairs out.  No new user-facing strings — the
 * empty state reuses the panel's existing `circle.screen.empty` key
 * (invariant #8), exactly like web.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';
import { recordFields } from '../../core/screenPanelDrilldown.js';

export default function CircleRecordScreen({ record, activity = null }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const fields = recordFields(record);
  if (!fields.length && !activity) {
    return (
      <View testID="circle-record-screen-empty">
        <Text style={styles.empty}>{t('circle.screen.empty')}</Text>
      </View>
    );
  }
  return (
    <View testID="circle-record-screen">
      {fields.map(({ key, text }) => (
        <View key={key} style={styles.field} testID={`record-field-${key}`}>
          <Text style={styles.key}>{key}</Text>
          <Text style={styles.value}>{text}</Text>
        </View>
      ))}
      {activity ? (
        /* The ACTIVITY CARD (web parity): the device log narrowed to this one agent —
         * rows say op/authority/outcome, never content. Empty state is honest. */
        <View style={styles.activity} testID="agent-activity-card">
          <Text style={styles.activityTitle}>{t('circle.agent_activity.title')}</Text>
          {activity.length === 0 ? (
            <Text style={styles.empty}>{t('circle.agent_activity.empty')}</Text>
          ) : activity.map((r) => (
            <View key={r.id ?? `${r.ts}-${r.op}`} style={styles.field}>
              <Text style={styles.key}>{r.ts ? new Date(r.ts).toLocaleString() : ''}</Text>
              <Text style={styles.value}>
                {t('circle.agent_activity.row', { op: r.op ?? '?', outcome: r.outcome ?? '' })}
                {r.via ? ` · ${t('circle.agent_activity.via', { via: r.via })}` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  activity: { marginTop: 18 },
  activityTitle: { fontSize: 13, fontWeight: '700', color: theme.color.ink, marginBottom: 6 },
  empty: { color: theme.color.inkSoft, fontStyle: 'italic', textAlign: 'center', paddingVertical: 24, paddingHorizontal: 12 },
  field: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  key:   { fontSize: 11, fontWeight: '700', color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  value: { fontSize: 14, color: theme.color.ink, lineHeight: 20 },
});
