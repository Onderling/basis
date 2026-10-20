/** The phone's button family: the look of each `BUTTON_VARIANTS` variant from the theme (Btn.js paints it; plain JS so
 *  the parity test can read it). Web twin: `.cc-btn--<variant>` in web/v2/circle.css. */
export function btnStyles(theme) {
  const c = theme.color;
  const base = { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 4, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center' };
  const text = { fontSize: 13.5, fontWeight: '700' };
  return {
    quiet:   { box: { ...base, borderColor: c.ink, borderRadius: 999 }, text: { ...text, color: c.ink } },
    primary: { box: { ...base, backgroundColor: c.accent }, text: { ...text, color: c.accentContrast } },
    danger:  { box: { ...base, backgroundColor: c.danger }, text: { ...text, color: c.accentContrast } },
    ghost:   { box: { ...base, paddingHorizontal: 6, borderWidth: 0 }, text: { ...text, fontWeight: '400', color: c.inkSoft } },
  };
}

