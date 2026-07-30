/**
 * **Platform: RN** (uses react-native primitives).
 *
 * Shared RN primitives for basis wizards — mirror of
 * `src/web/wizards/_wizardKit.js` (2026-05-26).
 *
 * Each wizard imports its state machine from
 * `src/core/wizards/<name>State.js` (portable, already split per
 * ) and uses these primitives to render via RN. Same
 * component contracts as the web kit so the wizards stay
 * structurally aligned across surfaces.
 *
 * Why live in `apps/basis/`?  The basis-unifier
 * principle: wizards are chat-shell orchestration over substrate
 * apps (stoop, contact-book, …).  They belong here next to the
 * state machine + web renderer, not in basis-mobile.  RN
 * apps that want to render the same wizards import from this
 * directory.
 *
 * No hardcoded strings policy — callers MUST pass localised
 * strings.  Helpers don't reach into `t()` themselves.
 */
import React from 'react';

import { LIGHT, wizardPalette } from './_palette.js';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet,
} from 'react-native';

export function Steps({ labels, current }) {
  const styles = makeStyles(useWizardPalette());
  return (
    <View style={styles.stepsRow} testID="wizard-steps">
      {labels.map((label, i) => {
        const stepNum  = i + 1;
        const isActive = stepNum === current;
        const isDone   = stepNum < current;
        return (
          <View key={label} style={styles.stepCell}>
            <View
              style={[
                styles.stepBubble,
                isActive && styles.stepBubbleActive,
                isDone   && styles.stepBubbleDone,
              ]}
            >
              <Text style={[
                styles.stepBubbleText,
                (isActive || isDone) && styles.stepBubbleTextActive,
              ]}>
                {stepNum}
              </Text>
            </View>
            <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function Body({ title, intro, children }) {
  const styles = makeStyles(useWizardPalette());
  return (
    <View style={styles.body}>
      {title ? <Text style={styles.bodyTitle}>{title}</Text> : null}
      {intro ? <Text style={styles.bodyIntro}>{intro}</Text> : null}
      {children}
    </View>
  );
}

export function Field({ label, value, onChangeText, placeholder, monospace }) {
  const styles = makeStyles(useWizardPalette());
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, monospace && styles.fieldInputMono]}
        value={value ?? ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCorrect
      />
    </View>
  );
}

export function Textarea({ label, value, onChangeText, placeholder, rows = 4 }) {
  const styles = makeStyles(useWizardPalette());
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { height: rows * 24 }]}
        value={value ?? ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline
        textAlignVertical="top"
      />
    </View>
  );
}

export function RadioGroup({ label, value, options, onChange, consequenceLabel }) {
  const styles = makeStyles(useWizardPalette());
  // N2 — when an option carries a `consequence` string (callers attach it
  // via `attachConsequences`), show an ⓘ that toggles the note inline.
  const [openInfo, setOpenInfo] = React.useState(null);
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {options.map((opt) => {
        const checked = opt.id === value;
        const open = openInfo === opt.id;
        return (
          <View key={opt.id}>
            <View style={styles.radioOptionRow}>
              <TouchableOpacity
                onPress={() => onChange?.(opt.id)}
                style={styles.radioRow}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                testID={`wizard-radio-${opt.id}`}
              >
                <View style={[styles.radioCircle, checked && styles.radioCircleChecked]}>
                  {checked ? <View style={styles.radioInner} /> : null}
                </View>
                <Text style={styles.radioLabel}>{opt.label}</Text>
              </TouchableOpacity>
              {opt.consequence ? (
                <TouchableOpacity
                  onPress={() => setOpenInfo(open ? null : opt.id)}
                  accessibilityRole="button"
                  accessibilityLabel={consequenceLabel}
                  accessibilityState={{ expanded: open }}
                  testID={`wizard-radio-info-${opt.id}`}
                  hitSlop={8}
                >
                  <Text style={styles.radioInfoIcon}>ⓘ</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {opt.consequence && open ? (
              <Text style={styles.radioConsequence}>{opt.consequence}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function Checkbox({ label, checked, onToggle, testID }) {
  const styles = makeStyles(useWizardPalette());
  return (
    <TouchableOpacity
      onPress={() => onToggle?.(!checked)}
      style={styles.checkRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!checked }}
      testID={testID}
    >
      <View style={[styles.checkBox, checked && styles.checkBoxChecked]}>
        {checked ? <Text style={styles.checkMark}>✓</Text> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Chips({ items, onPress }) {
  const styles = makeStyles(useWizardPalette());
  return (
    <View style={styles.chipsRow}>
      {items.map((it, i) => (
        <TouchableOpacity
          key={`${it}-${i}`}
          onPress={() => onPress?.(it)}
          style={styles.chip}
          accessibilityRole="button"
        >
          <Text style={styles.chipText}>{it}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function ContextCard({ label, quoteText, placeholder }) {
  const styles = makeStyles(useWizardPalette());
  return (
    <View style={styles.contextCard}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.contextQuote}>
        <Text style={styles.contextQuoteText}>
          {quoteText ?? placeholder ?? ''}
        </Text>
      </View>
    </View>
  );
}

export function Actions({ buttons }) {
  const styles = makeStyles(useWizardPalette());
  return (
    <View style={styles.actionsRow}>
      {buttons.map((b, i) => {
        const isPrimary = b.kind === 'primary';
        return (
          <TouchableOpacity
            key={`${b.label}-${i}`}
            onPress={b.onPress}
            disabled={!!b.disabled}
            style={[
              styles.actionBtn,
              isPrimary ? styles.actionBtnPrimary : styles.actionBtnSecondary,
              b.disabled && styles.actionBtnDisabled,
            ]}
            accessibilityRole="button"
            testID={`wizard-action-${b.label}`}
          >
            <Text
              style={[
                styles.actionBtnText,
                isPrimary ? styles.actionBtnTextPrimary : styles.actionBtnTextSecondary,
                b.disabled && styles.actionBtnTextDisabled,
              ]}
            >
              {b.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function ErrorBanner({ message }) {
  const styles = makeStyles(useWizardPalette());
  if (!message) return null;
  return (
    <View style={styles.errorBanner} testID="wizard-error">
      <Text style={styles.errorBannerText}>{message}</Text>
    </View>
  );
}

export function Submitting({ visible, label }) {
  const styles = makeStyles(useWizardPalette());
  if (!visible) return null;
  return (
    <View style={styles.submittingRow} testID="wizard-submitting">
      <ActivityIndicator size="small" />
      <Text style={styles.submittingLabel}>{label}</Text>
    </View>
  );
}

export function ReviewList({ items }) {
  const styles = makeStyles(useWizardPalette());
  return (
    <View style={styles.reviewList}>
      {items.map((it, i) => (
        <View key={`${it.label}-${i}`} style={styles.reviewRow}>
          <Text style={styles.reviewLabel}>{it.label}</Text>
          <Text style={[
            styles.reviewValue,
            it.monospace && styles.reviewValueMono,
            it.pre && styles.reviewValuePre,
          ]}>
            {it.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function Warn({ children }) {
  const styles = makeStyles(useWizardPalette());
  return (
    <View style={styles.warnBox}>
      <Text style={styles.warnText}>{children}</Text>
    </View>
  );
}

/**
 * The wizard kit's palette — set by the shell, defaulted to what it always was.
 *
 * Every colour below used to be a literal, which was invisible until the join sheet started following the
 * app's dark theme (2026-07-30): the SHEET went dark and its contents stayed dark grey on dark, so
 * "Pick a name", the step labels and the field labels were all but unreadable. Theming the container and
 * not its contents is worse than theming neither.
 *
 * A context rather than a prop on every component: these are ~10 small primitives used dozens of times,
 * and threading a theme through each call site would be a lot of edits for a value that is constant for
 * the whole sheet. The shell wraps the wizard in `WizardTheme` and the kit reads it — the dependency still
 * points from the shell into the shared tree, never the other way.
 */
const WizardThemeContext = React.createContext(LIGHT);


/** Wrap a wizard so the kit's primitives follow the host's theme. */
export function WizardTheme({ theme, children }) {
  const value = React.useMemo(() => wizardPalette(theme), [theme]);
  return <WizardThemeContext.Provider value={value}>{children}</WizardThemeContext.Provider>;
}

/** The palette in force. Used by the kit's own components; exported for a wizard's local styles. */
export function useWizardPalette() {
  return React.useContext(WizardThemeContext);
}

/** The kit's stylesheet, built from the palette in force. See `WizardTheme`. */
function makeStyles(p) {
  return StyleSheet.create({
  stepsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.hair,
  },
  stepCell: { alignItems: 'center', flex: 1 },
  stepBubble: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: p.rail,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  stepBubbleActive: { backgroundColor: p.accent },
  stepBubbleDone:   { backgroundColor: p.done },
  stepBubbleText:   { fontSize: 12, fontWeight: '700', color: p.inkSoft },
  stepBubbleTextActive: { color: p.onAccent },
  stepLabel:        { fontSize: 11, color: p.inkSoft },
  stepLabelActive:  { color: p.ink, fontWeight: '600' },

  body:       { padding: 16, gap: 12 },
  bodyTitle:  { fontSize: 18, fontWeight: '700', color: p.ink },
  bodyIntro:  { fontSize: 13, color: p.inkSoft, lineHeight: 18 },

  fieldRow:    { gap: 6, marginTop: 4 },
  fieldLabel:  { fontSize: 12, color: p.inkMuted, fontWeight: '600' },
  fieldInput: {
    borderWidth: 1, borderColor: p.hair, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14,
    backgroundColor: p.card,
  },
  fieldInputMono: { fontFamily: 'monospace' },

  radioRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8, flex: 1 },
  // N2 — option row holds the radio + the ⓘ button; the note sits below.
  radioOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  radioInfoIcon:  { fontSize: 15, color: p.info, paddingHorizontal: 4 },
  radioConsequence: {
    fontSize: 12, lineHeight: 17, color: p.inkSoft,
    marginLeft: 28, marginBottom: 6, paddingLeft: 8,
    borderLeftWidth: 2, borderLeftColor: p.hair,
  },
  radioCircle: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: p.inkSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  radioCircleChecked: { borderColor: p.accent },
  radioInner: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: p.accent,
  },
  radioLabel: { fontSize: 13, color: p.ink, flex: 1 },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, gap: 10 },
  checkBox: {
    width: 18, height: 18, borderRadius: 4, borderWidth: 2,
    borderColor: p.inkSoft, alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  checkBoxChecked: { backgroundColor: p.accent, borderColor: p.accent },
  checkMark: { color: p.card, fontSize: 12, fontWeight: '700' },
  checkLabel: { flex: 1, fontSize: 13, color: p.ink, lineHeight: 18 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: p.accentSoft, borderRadius: 14,
  },
  chipText: { color: p.accentStrong, fontSize: 12, fontWeight: '600' },

  contextCard: { padding: 10, backgroundColor: p.quote, borderRadius: 8, gap: 4 },
  contextQuote: { borderLeftWidth: 3, borderLeftColor: p.accent, paddingLeft: 10 },
  contextQuoteText: { fontSize: 13, fontStyle: 'italic', color: p.ink },

  actionsRow: {
    flexDirection: 'row', justifyContent: 'flex-end',
    padding: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: p.hair,
  },
  actionBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  actionBtnPrimary:   { backgroundColor: p.accent },
  actionBtnSecondary: { backgroundColor: p.railSoft },
  actionBtnDisabled:  { backgroundColor: p.hair },
  actionBtnText:      { fontSize: 14, fontWeight: '600' },
  actionBtnTextPrimary:   { color: p.card },
  actionBtnTextSecondary: { color: p.inkStrong },
  actionBtnTextDisabled:  { color: p.inkFaint },

  errorBanner: {
    backgroundColor: p.dangerSurface, padding: 10, borderRadius: 8,
    borderWidth: 1, borderColor: p.dangerEdge, marginTop: 8,
  },
  errorBannerText: { fontSize: 13, color: p.danger },

  submittingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  submittingLabel: { fontSize: 13, color: p.inkSoft },

  reviewList:  { gap: 6, marginTop: 4 },
  reviewRow:   { gap: 2 },
  reviewLabel: { fontSize: 11, color: p.inkSoft, fontWeight: '600' },
  reviewValue: { fontSize: 14, color: p.ink },
  reviewValueMono: { fontFamily: 'monospace', fontSize: 12 },
  reviewValuePre:  { fontFamily: 'monospace', fontSize: 13 },

  warnBox: {
    backgroundColor: p.warnSurface, padding: 10, borderRadius: 8,
    borderWidth: 1, borderColor: p.warnEdge, marginTop: 8,
  },
  warnText: { fontSize: 12, color: p.infoInk },
  });
}

// Re-exported: the modal builds its own sheet styles from the SAME palette, so the container and its
// contents cannot disagree — which is exactly how the dark-sheet-with-dark-text bug happened.
export { wizardPalette };
