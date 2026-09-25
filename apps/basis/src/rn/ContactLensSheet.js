/**
 * **Platform: RN**. What a contact sees of you (L125) — mobile parity for `web/v2/contactLensPanel.js`: the ADD SHEET
 * before a scanned card is added, and the thread header's control to change it later. The logic is
 * `src/v2/contactLens.js`; this paints a model and hands back the choice.
 *
 * `useContactLensSheet` turns "ask the person" into a promise a flow can await, and renders the one sheet that
 * answers it — so a screen adds `{lens.sheet}` to its tree and calls `lens.addWithSheet(payload)` or
 * `lens.openLens(contactId, name)`. Closing the sheet any way but the primary button is a cancel.
 */
import React, { useState, useCallback, useRef } from 'react';   // useRef: the ask counter
import { Modal, View, ScrollView, Pressable, Text, StyleSheet } from 'react-native';
import { RadioGroup, Actions, WizardTheme } from './wizards/_kit.js';
import { wizardPalette } from './wizards/_palette.js';
import {
  contactAddSheetModel, addContactAs, contactLensModel, changeContactLens,
} from '../v2/contactLens.js';
import { DEFAULT_PERSONA } from '../v2/contactPersona.js';

/** The sheet itself: persona + level, prefilled, the honest hint, cancel / confirm. */
export function ContactLensSheet({ visible, mode = 'change', model, t, theme, onSubmit, onCancel }) {
  const p = wizardPalette(theme);
  const styles = sheetStyles(p);
  // Each ask mounts a fresh sheet (the hook keys it), so these start from that ask's prefills.
  const [persona, setPersona] = useState(model?.persona ?? DEFAULT_PERSONA);
  const [level, setLevel] = useState(model?.revealPreset ?? 'profile');
  if (!model) return null;
  const personas = model.personas?.length ? model.personas : [{ id: DEFAULT_PERSONA, name: DEFAULT_PERSONA }];
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <WizardTheme theme={theme}>
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} testID={mode === 'add' ? 'contact-add-sheet' : 'contact-lens'}>
            <ScrollView>
              <Text style={styles.title}>
                {mode === 'add' ? t('circle.contacts.add_sheet.title', { name: model.name }) : t('circle.contacts.lens.title', { name: model.name })}
              </Text>
              {mode === 'add' ? <Text style={styles.intro}>{t('circle.contacts.add_sheet.intro', { name: model.name })}</Text> : null}
              <RadioGroup
                label={t('circle.contacts.lens.persona')}
                value={persona}
                onChange={setPersona}
                options={personas.map((x) => ({
                  id: x.id,
                  label: x.id === DEFAULT_PERSONA ? t('circle.join.wizard.persona.default_suffix', { name: x.name }) : x.name,
                }))}
              />
              <RadioGroup
                label={t('circle.contacts.lens.level')}
                value={level}
                onChange={setLevel}
                options={(model.presets ?? []).map((x) => ({ id: x, label: t(`circle.reveal.preset.${x}`) }))}
              />
              <Text style={styles.hint}>{t('circle.contacts.lens.hint')}</Text>
            </ScrollView>
            <Actions buttons={[
              { label: t('circle.contacts.lens.cancel'), onPress: onCancel, kind: 'secondary' },
              { label: t(mode === 'add' ? 'circle.contacts.add_sheet.add' : 'circle.contacts.lens.save'),
                onPress: () => onSubmit({ persona, revealPreset: level }), kind: 'primary' },
            ]} />
          </Pressable>
        </Pressable>
      </WizardTheme>
    </Modal>
  );
}

/**
 * @param {object} a
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill
 * @param {(contactWebid: string) => string} [a.pairCircleIdOf]   the pair roster's own `pairCircleIdFor`
 * @param {(circleId: string, personaId: string) => Promise<any>} [a.shareRelease]   the bundle's `shareCircleRelease`
 * @param {Function} a.t
 * @param {object} [a.theme]
 */
export function useContactLensSheet({ callSkill, pairCircleIdOf = null, shareRelease = null, t, theme } = {}) {
  const [ask, setAsk] = useState(null);   // { id, mode, model, resolve }
  const seq = useRef(0);
  const answer = useCallback((choice) => {
    setAsk((cur) => { cur?.resolve?.(choice); return null; });
  }, []);
  const askPerson = useCallback((mode, model) => new Promise((resolve) => {
    seq.current += 1;
    setAsk({ id: seq.current, mode, model, resolve });
  }), []);

  /** Add a card AFTER the sheet: the stoop reply, or `null` when the person closed it (nothing added). */
  const addWithSheet = useCallback(async (payload) => {
    const model = await contactAddSheetModel({ payload, callSkill });
    if (!model) return callSkill('stoop', 'addContactFromQr', { payload, persona: DEFAULT_PERSONA });
    const choice = await askPerson('add', model);
    if (!choice) return null;
    return addContactAs({ callSkill, payload, ...choice, pairCircleIdOf });
  }, [callSkill, pairCircleIdOf, askPerson]);

  /** The thread header's control: the row's lens, changed in place; `{ saved, personaName }` or `null` (closed). */
  const openLens = useCallback(async (contactId, name) => {
    let row = null;
    try { row = ((await callSkill('stoop', 'listContacts', {}))?.contacts ?? []).find((c) => c?.webid === contactId) ?? null; } catch { row = null; }
    const model = await contactLensModel({ callSkill, row: row ?? { webid: contactId }, pairCircleIdOf });
    const choice = await askPerson('change', { ...model, name: name || row?.displayName || row?.handle || contactId });
    if (!choice) return null;
    const r = await changeContactLens({ callSkill, contactId, ...choice, shareRelease, pairCircleIdOf });
    return { saved: !r?.error, personaName: model.personas.find((x) => x.id === choice.persona)?.name ?? choice.persona };
  }, [callSkill, pairCircleIdOf, shareRelease, askPerson]);

  const sheet = (
    <ContactLensSheet
      key={ask?.id ?? 0}
      visible={!!ask}
      mode={ask?.mode ?? 'change'}
      model={ask?.model ?? null}
      t={t}
      theme={theme}
      onSubmit={(c) => answer(c)}
      onCancel={() => answer(null)}
    />
  );
  return { sheet, addWithSheet, openLens };
}

function sheetStyles(p) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: p.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '85%' },
    title: { fontSize: 17, fontWeight: '700', color: p.ink, marginBottom: 8 },
    intro: { fontSize: 14, lineHeight: 20, color: p.inkStrong, marginBottom: 10 },
    hint:  { fontSize: 12, lineHeight: 17, color: p.inkSoft, marginTop: 6, marginBottom: 6 },
  });
}
