/**
 * Mobile's way of drawing a face. Web parity: `web/v2/faceView.js` is the same file for the other shell.
 *
 * The DECISION — picture or initial, and which name — is `faceOf` in the basis app's `src/v2/memberFace.js`,
 * shared by both; this is only the drawing. One component rather than three, because a Contacten row, a
 * roster row and a thread header show the same person and must show them the same way.
 *
 * The picture is a SEALED media ref — the persona's `profilePicture`, re-sealed for this circle when it was
 * disclosed — so the host passes a resolver bound to the circle's media opener, the same one the Mij preview
 * and the member card use. No resolver, or an open that fails, and the row keeps the person's initial.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { faceOf } from '../../../../basis/src/v2/memberFace.js';
import { useTheme } from './themeContext.js';

/**
 * @param {object} props
 * @param {object} props.row              a Contacten row, a roster row, or a thread header's subject
 * @param {Function} [props.resolvePicture]  (ref) => Promise<string|null> — unseal to a displayable uri
 * @param {number} [props.size]           the slot's side in px
 * @param {string} [props.fallbackGlyph]  drawn instead of an initial (a bot's emoji — it is not a person)
 */
export default function FaceView({ row, resolvePicture = null, size = 32, fallbackGlyph = null }) {
  const theme = useTheme();
  const styles = makeStyles(theme, size);
  const face = faceOf(row);
  const [uri, setUri] = useState(null);

  // The initial shows until a picture is actually open. A sealed thumbnail takes a moment and may not open at
  // all, and a row that shows nothing in the meantime reads as a person who is missing.
  useEffect(() => {
    let alive = true;
    setUri(null);
    if (face.kind !== 'picture' || typeof resolvePicture !== 'function') return undefined;
    Promise.resolve(resolvePicture(face.picture)).then((u) => { if (alive && u) setUri(u); }).catch(() => { /* the initial stands */ });
    return () => { alive = false; };
  }, [face.kind, face.picture, resolvePicture]);

  if (fallbackGlyph) {
    return <View style={styles.slot}><Text style={styles.glyph}>{fallbackGlyph}</Text></View>;
  }
  if (uri) {
    return (
      <View style={styles.slot}>
        <Image
          source={{ uri }}
          style={styles.img}
          accessibilityIgnoresInvertColors
          accessible={false}          /* the name is beside it; a screen reader should not hear it twice */
          onError={() => setUri(null)}
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
