/**
 * QrScannerModal — full-screen camera + barcode-scan path for
 * basis-mobile (2026-05-27).
 *
 * Reuses the proven shape from apps/stoop-mobile's OnboardScanScreen:
 *   - useCameraPermissions for runtime grant
 *   - CameraView with barcodeScannerSettings:{barcodeTypes:['qr']}
 *   - scanLock so one barcode = one onResult call
 *   - A "Paste instead" affordance when the camera isn't a fit
 *     (permission denied, blurry QR, simulator)
 *
 * Calls `onResult({kind, payload})` where `kind` is whatever the
 * registered classifiers returned (e.g. 'contact', 'invite') or
 * `'unknown'`.  The owning screen decides what to do with the
 * payload — routes to /add-contact-from-qr, opens joinGroup wizard,
 * etc.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, TextInput, Modal, StyleSheet, ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { classifyQrPayload } from '@onderling/react-native/qr';
import { getBasisClassifiers } from '../core/qrClassifiers.js';
import { theme } from '../screens/v2/theme.js';

export default function QrScannerModal({ visible, onClose, onResult, t }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanLock, setScanLock]   = useState(false);
  const [hint, setHint]           = useState(null);
  const [pasted, setPasted]       = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const CLASSIFIERS = getBasisClassifiers();

  const dispatch = useCallback((res) => {
    if (res.kind === 'unknown') {
      setHint(t('scan_qr.scan_unknown'));
      return;
    }
    setScanLock(true);
    onResult?.(res);
    onClose?.();
  }, [onResult, onClose, t]);

  const onBarcode = useCallback(({ data }) => {
    if (scanLock) return;
    dispatch(classifyQrPayload(String(data), CLASSIFIERS));
  }, [scanLock, dispatch, CLASSIFIERS]);

  const submitPasted = useCallback(() => {
    dispatch(classifyQrPayload(pasted.trim(), CLASSIFIERS));
  }, [pasted, dispatch, CLASSIFIERS]);

  // Reset lock when the modal is shown again.
  React.useEffect(() => {
    if (visible) {
      setScanLock(false);
      setHint(null);
      setPasted('');
      setShowPaste(false);
    }
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('chat.scan_heading')}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>×</Text>
          </Pressable>
        </View>

        {permission == null ? (
          <View style={styles.body}><Text style={styles.bodyText}>…</Text></View>
        ) : !permission.granted ? (
          <View style={styles.body}>
            <Text style={styles.bodyText}>{t('chat.scan_perm_rationale')}</Text>
            <Pressable onPress={requestPermission} style={styles.primaryBtn} accessibilityRole="button">
              <Text style={styles.primaryBtnText}>{t('chat.scan_grant_perm')}</Text>
            </Pressable>
            <PasteToggle
              visible={showPaste} value={pasted}
              onChange={setPasted}
              onShow={() => setShowPaste(true)}
              onSubmit={submitPasted}
              t={t}
            />
          </View>
        ) : (
          <>
            <CameraView
              style={styles.cameraSurface}
              facing="back"
              onBarcodeScanned={onBarcode}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            />
            <ScrollView contentContainerStyle={styles.controls}>
              <Text style={styles.bodyText}>{t('chat.scan_subheading')}</Text>
              {hint ? <Text style={styles.hintText}>{hint}</Text> : null}
              <PasteToggle
                visible={showPaste} value={pasted}
                onChange={setPasted}
                onShow={() => setShowPaste(true)}
                onSubmit={submitPasted}
                t={t}
              />
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

function PasteToggle({ visible, value, onChange, onShow, onSubmit, t }) {
  if (!visible) {
    return (
      <Pressable onPress={onShow} style={styles.pasteToggle} accessibilityRole="link">
        <Text style={styles.pasteToggleText}>{t('chat.scan_paste_link')}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.pasteBlock}>
      <TextInput
        value={value} onChangeText={onChange}
        multiline placeholder={t('circle.scan.paste_placeholder')}
        style={styles.pasteInput}
        autoCapitalize="none" autoCorrect={false}
        accessibilityLabel="scan-paste-input"
      />
      <Pressable onPress={onSubmit} style={styles.primaryBtn} accessibilityRole="button">
        <Text style={styles.primaryBtnText}>{t('chat.scan_paste_submit')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: theme.color.card },
  header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.line },
  title:         { fontSize: 18, fontWeight: '600' },
  closeBtn:      { padding: 4, minWidth: 32, alignItems: 'center' },
  closeBtnText:  { fontSize: 24, color: theme.color.inkSoft },
  body:          { padding: 16 },
  bodyText:      { fontSize: 14, color: theme.color.inkSoft, lineHeight: 20, marginBottom: 12 },
  hintText:      { color: theme.color.amber, fontSize: 13, marginBottom: 12 },
  cameraSurface: { aspectRatio: 1, backgroundColor: '#000' }, // hex-ok: QR scanner contrast (camera backdrop)
  controls:      { padding: 16 },
  primaryBtn:    { backgroundColor: theme.color.accent, paddingVertical: 12, borderRadius: 6, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: theme.color.accentContrast, fontSize: 14, fontWeight: '600' },
  pasteToggle:   { paddingVertical: 12, alignItems: 'center' },
  pasteToggleText: { color: theme.color.accentInk, fontSize: 13 },
  pasteBlock:    { marginTop: 12 },
  pasteInput:    { minHeight: 80, borderWidth: 1, borderColor: theme.color.line, borderRadius: 4, padding: 12, fontSize: 13, textAlignVertical: 'top' },
});
