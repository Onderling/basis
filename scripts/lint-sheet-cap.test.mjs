import { describe, it, expect } from 'vitest';
import { percentCaps, currentHits } from './lint-sheet-cap.mjs';

describe('lint-sheet-cap — a phone sheet is capped in window pixels, never a percentage', () => {
  it('finds a percentage maxHeight in a style', () => {
    const src = "const s = StyleSheet.create({\n  card: { padding: 16, maxHeight: '85%' },\n});\n";
    expect(percentCaps(src)).toEqual([2]);
  });
  it('finds it with double quotes and spaces too', () => {
    expect(percentCaps('x = { maxHeight : "80%" }')).toEqual([1]);
  });
  it('lets a pixel cap and the shared hook pass', () => {
    expect(percentCaps("card: { maxHeight: 400 },\n<View style={[styles.card, sheetCap]} />")).toEqual([]);
  });
  it('ignores a comment that names the old way', () => {
    expect(percentCaps(" * A card capped with a PERCENTAGE (`maxHeight: '85%'`) did not bound it\n// maxHeight: '80%' was wrong")).toEqual([]);
  });
  it('the phone app has none today', () => {
    expect(currentHits()).toEqual([]);
  });
});
