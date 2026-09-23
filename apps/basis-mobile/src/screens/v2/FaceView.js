/**
 * Mobile's way of drawing a face. Web parity: `web/v2/faceView.js` is the same file for the other shell.
 *
 * The DECISION — picture or initial, and which name — is `faceOf` in the basis app's `src/v2/memberFace.js`,
 * shared by both; this is only the drawing. One component rather than three, because a Contacten row, a
 * roster row and a thread header show the same person and must show them the same way.
 */
import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { faceOf } from '../../../../basis/src/v2/memberFace.js';
import { useTheme } from './themeContext.js';

/**
 * @param {object} props
 * @param {object} props.row              a Contacten row, a roster row, or a thread header's subject
 * @param {number} [props.size]           the slot's side in px
 * @param {string} [props.fallbackGlyph]  drawn instead of an initial (a bot's emoji — it is not a person)
 */
export default function FaceView({ row, size = 32, fallbackGlyph = null }) {
  const theme = useTheme();
  // A picture that will not decode (a truncated statement, a format this device lacks) must not leave a hole
  // where a person was: fall back to the letter the row would have had.
  const [broken, setBroken] = useState(false);
  const face = faceOf(row);
  const styles = makeStyles(theme, size);

  if (fallbackGlyph) {
    return <View style={styles.slot}><Text style={styles.glyph}>{fallbackGlyph}</Text></View>;
  }
  if (face.kind === 'thumb' && !broken) {
    return (
      <View style={styles.slot}>
        <Image
          source={{ uri: face.thumb }}   /* inline `data:image/` only — `faceOf` refuses anything fetchable */
          style={styles.img}
          accessibilityIgnoresInvertColors
          accessible={false}             /* the name is beside it; a screen reader should not hear it twice */
          onError={() => setBroken(true)}
        />
      </View>
    );
  }
  return <View style={styles.slot}><Text style={styles.initial}>{face.initial}</Text></View>;
}

const makeStyles = (theme, size) => StyleSheet.create({
  slot: {
    width: size, height: size, borderRadius: size / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.color.line,   // the ground under a decoding picture, and behind an initial
    overflow: 'hidden',
  },
  // `cover`, never `contain`: a face squashed to fit reads as the wrong person.
  img: { width: '100%', height: '100%', resizeMode: 'cover' },
  initial: { fontSize: Math.round(size * 0.45), color: theme.color.ink, fontWeight: '600' },
  glyph: { fontSize: Math.round(size * 0.6) },
});
