/**
 * QrCodeView — render a QR code via react-native-qrcode-svg.
 *
 * Lifted from apps/stoop-mobile/src/components/QrCode.js 2026-05-09
 * (Phase 41.0 L4; Tasks-mobile is the second consumer). The wrapper
 * exists so consumers can swap implementations later (e.g. fall back
 * to a hand-rolled SVG renderer if the lib goes unmaintained).
 *
 * Renamed from `QrCode` to `QrCodeView` to make the View / Component
 * nature explicit (matches the plan's spec).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

/**
 * @param {object} args
 * @param {string} args.value          payload to encode
 * @param {number} [args.size=240]     side length in DIPs
 * @param {string} [args.backgroundColor='#fff']
 * @param {string} [args.color='']
 * @param {'L'|'M'|'Q'|'H'} [args.ecl='M']  error-correction level — L leaves the most room per module (a long payload on a screen)
 * @param {number} [args.quietZone]        the white border in DIPs; absent → the frame's padding alone
 */
export function QrCodeView({ value, size = 240, backgroundColor = '#fff', color = '#000', ecl = 'M', quietZone = undefined }) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return (
    <View style={[styles.frame, { backgroundColor, padding: size * 0.04 }]}>
      <QRCode
        value={value}
        size={size}
        backgroundColor={backgroundColor}
        color={color}
        ecl={ecl}
        {...(quietZone != null ? { quietZone } : {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems:    'center',
    justifyContent: 'center',
    borderRadius:  8,
  },
});
