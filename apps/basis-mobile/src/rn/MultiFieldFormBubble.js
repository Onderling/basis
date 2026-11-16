/**
 * MultiFieldFormBubble — inline bot-bubble that renders a multi-field
 * form for step 6.
 *
 * Renders one TextInput per field in `pending.fields`, plus a Submit
 * button.  Local state holds the in-progress values; on Submit, the
 * caller's `onSubmit(values)` runs (ChatScreen wires it to
 * `completeMultiFieldFollowUp` + dispatchAndAppend).  Submit stays
 * disabled while any required field is empty.
 *
 * Cancellation is V0: the user can switch threads via the drawer to
 * park the form, or just dismiss the field by submitting empty
 * strings (caller decides what to do on empty input).  An explicit
 * [Cancel] affordance can land later.
 *
 * No hardcoded strings — every label via t().
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';

import { t } from '../core/localisation.js';
import { theme } from '../screens/v2/theme.js';
import ThemedTextInput from '../screens/v2/ThemedTextInput.js';   // every text input's colours come from the theme (lint-themed-inputs)

export default function MultiFieldFormBubble({ pending, onSubmit }) {
  const initial = useMemo(() => {
    const m = {};
    for (const f of pending.fields ?? []) m[f.name] = '';
    return m;
  }, [pending]);
  const [values, setValues] = useState(initial);

  const setField = useCallback((name, v) => {
    setValues((prev) => ({ ...prev, [name]: v }));
  }, []);

  const allFilled = useMemo(
    () => (pending.fields ?? []).every((f) => String(values[f.name] ?? '').trim().length > 0),
    [pending.fields, values],
  );

  const submit = useCallback(() => {
    if (!allFilled) return;
    onSubmit?.(values);
  }, [allFilled, onSubmit, values]);

  return (
    <View
      style={styles.bubble}
      testID={`form-bubble-${pending.opId}`}
    >
      <Text style={styles.title}>{pending.title}</Text>
      {(pending.fields ?? []).map((f) => (
        <View key={f.name} style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{f.label}</Text>
          <ThemedTextInput
            style={styles.fieldInput}
            value={values[f.name] ?? ''}
            onChangeText={(v) => setField(f.name, v)}
            placeholder={f.placeholder ?? f.label}
            autoCorrect
            multiline={false}
            testID={`form-field-${pending.opId}-${f.name}`}
          />
        </View>
      ))}
      <TouchableOpacity
        onPress={submit}
        disabled={!allFilled}
        style={[styles.submitBtn, !allFilled && styles.submitBtnDisabled]}
        accessibilityRole="button"
        testID={`form-submit-${pending.opId}`}
      >
        <Text style={styles.submitBtnText}>
          {t('chat.form_submit')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    backgroundColor: theme.color.paper2,
    alignSelf: 'stretch',
    padding: 12,
    borderRadius: 12,
    marginBottom: 4,
    gap: 8,
  },
  title: { fontSize: 14, fontWeight: '700', color: theme.color.ink },
  fieldRow: { gap: 4 },
  fieldLabel: { fontSize: 12, color: theme.color.inkSoft },
  fieldInput: { color: theme.color.ink,
    borderWidth: 1, borderColor: theme.color.line, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, fontSize: 14,
    backgroundColor: theme.color.card,
  },
  submitBtn: {
    alignSelf: 'flex-end',
    backgroundColor: theme.color.accent,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 18, marginTop: 4,
  },
  submitBtnDisabled: { backgroundColor: theme.color.trackOff },
  submitBtnText: { color: theme.color.accentContrast, fontWeight: '600', fontSize: 13 },
});
