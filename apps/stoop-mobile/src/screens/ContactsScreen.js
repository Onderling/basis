/**
 * ContactsScreen — list of contacts + search + add via QR.
 *
 * Stoop V3 mobile.  Phase 40.18 (2026-05-08): wired to live agent
 * via `listContacts` + `addContactFromQr` (when route lands with a
 * `pendingContact` URI from the OnboardScan flow).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/localisation.js';
import { filterContacts, sortContactsByName } from '../lib/contacts.js';
import { AvatarCircle }                      from '../components/AvatarCircle.js';
import { useService }                        from '../ServiceContext.js';
import { useSkill }                          from '../lib/useSkill.js';
import { useSkillResult }                    from '../lib/useSkillResult.js';

export function ContactsScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const svc = useService();

  const pendingContact = route?.params?.pendingContact;
  const [query, setQuery] = useState('');
  const [pendingHandled, setPendingHandled] = useState(false);
  const [pendingError, setPendingError]     = useState(null);

  const { data, loading, refresh } = useSkillResult('listContacts', {}, []);
  const addFromQr = useSkill('addContactFromQr');

  // If a contact-QR brought us here, redeem once.
  useEffect(() => {
    if (!pendingContact || pendingHandled) return;
    setPendingHandled(true);
    // Skill expects `payload`, not `uri` — it validates
    // `payload.startsWith('onderling-contact://')` and decodes the rest.
    addFromQr.call({ payload: pendingContact })
      .then((r) => {
        if (r?.error) throw new Error(r.error);
        return refresh();
      })
      .catch((err) => setPendingError(err?.message ?? String(err)));
  }, [pendingContact, pendingHandled, addFromQr, refresh]);

  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('contacts.no_active_group',
             'Sluit eerst aan bij een groep om je contacten te zien.')}
        </Text>
      </View>
    );
  }

  const all = Array.isArray(data?.contacts) ? data.contacts : [];
  const sorted = sortContactsByName(filterContacts(all, query));

  return (
    <View style={styles.root}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('contacts.search_placeholder', 'Zoek op naam of @handle')}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel="contacts-search-input"
        />
      </View>

      {pendingError ? <Text style={styles.errorText}>{pendingError}</Text> : null}
      {loading && sorted.length === 0 ? <ActivityIndicator style={{ margin: SPACING.lg }} /> : null}

      <FlatList
        data={sorted}
        keyExtractor={(c) => String(c.id ?? c.webid ?? c.handle)}
        refreshing={loading}
        onRefresh={refresh}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => nav.navigate(ROUTES.Contact, { contactId: item.id ?? item.webid, contact: item })}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`contact-row-${item.id ?? item.webid}`}
          >
            <AvatarCircle uri={item.avatarUrl ?? item.avatarUri} name={item.displayName ?? item.handle} size={44} />
            <View style={styles.rowText}>
              <Text style={styles.handle}>
                {item.revealed && item.displayName ? item.displayName : `@${item.handle ?? '?'}`}
              </Text>
              {item.revealed && item.displayName ? (
                <Text style={styles.subhandle}>@{item.handle ?? '?'}</Text>
              ) : null}
              {item.trust ? (
                <Text style={styles.trust}>
                  {item.trust === 'vertrouwd'
                    ? t('contacts.trust_vertrouwd', 'trusted')
                    : t('contacts.trust_bekend', 'acquainted')}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {all.length === 0
                ? t('contacts.empty_no_contacts', 'Nog geen contacten.')
                : t('contacts.empty_filtered',    'Geen contacten voor deze zoekopdracht.')}
            </Text>
          </View>
        )}
      />

      <Pressable
        onPress={() => nav.navigate(ROUTES.OnboardScan, { from: 'contacts' })}
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel="contacts-add-fab"
      >
        <Text style={styles.fabLabel}>{'+'}</Text>
      </Pressable>
    </View>
  );
}

export default ContactsScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  searchRow: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  searchInput: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    fontSize: FONT_SIZES.md, color: COLORS.text,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    backgroundColor: COLORS.surface,
  },
  rowPressed: { backgroundColor: COLORS.surfaceMuted },
  rowText:    { flex: 1, marginLeft: SPACING.md },
  handle:     { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text },
  subhandle:  { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: 2 },
  trust:      { fontSize: FONT_SIZES.xs, color: COLORS.info, marginTop: 2 },
  separator:  { height: 1, backgroundColor: COLORS.border, marginLeft: SPACING.lg + 44 + SPACING.md },
  empty:      { padding: SPACING.xxl, alignItems: 'center' },
  emptyText:  { fontSize: FONT_SIZES.md, color: COLORS.textMuted, textAlign: 'center' },
  errorText:  { color: COLORS.danger, fontSize: FONT_SIZES.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  fab: {
    position: 'absolute', right: SPACING.lg, bottom: SPACING.lg,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    elevation: 4,
  },
  fabLabel: {
    color: COLORS.textInverse, fontSize: FONT_SIZES.xxl,
    lineHeight: FONT_SIZES.xxl, fontWeight: '600',
  },
});
