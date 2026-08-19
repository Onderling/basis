/**
 * basis-mobile v2 — screen renderer (α.1e.1).
 *
 * RN counterpart of web's circleScreen.js — consumes the same
 * materialized blocks (`materializeRecipe(...)`) and renders the
 * screen-mode page.
 *
 * Per-type render:
 *   announcement → serif headline card
 *   text         → paragraph card
 *   photo        → image with optional caption
 *   noticeboard  → list of recent posts (sender · text)
 *   agenda       → list of upcoming events (label)
 *   rules        → per-field rendered governance doc
 *
 * Per-block status:
 *   ok    → normal render
 *   empty → muted per-block fallback ("nothing to show here yet")
 *   error → red border + error message; one bad block doesn't break
 *           the rest of the page.
 *
 * Empty `blocks` array → top-level empty state ("admin hasn't set up
 * a screen yet").
 */
import React, { useMemo } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { featureActionLabelKey } from '@onderling-app/basis';
import { embedChipsOf, embedTypeLabelKey, shortRef, screenForEmbedType } from '../../../../basis/src/v2/embedChips.js';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

// An embed `ref` may be a full URN (urn:dec:item:T2) while a rendered row
// carries only the local id (T2).  Match the raw ref OR its local-id tail so a
// chip tap can find its row regardless of which form each side holds.
function matchesHighlight(rowId, highlightRef) {
  if (!rowId || !highlightRef) return false;
  return rowId === highlightRef || String(highlightRef).endsWith(String(rowId));
}

export default function CircleScreenView({ blocks = null, refreshing = false, onAction, onEmbedOpen, highlightRef, highlightRowRef = null, onHighlightLayout = null }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // null = still materializing (host hasn't resolved yet).  Distinguish
  // from `[]` so the user sees a "Loading…" hint instead of the
  // "admin hasn't set up a screen yet" empty state — which is
  // visually identical and made the materialize wait feel broken.
  if (blocks === null || blocks === undefined) {
    return (
      <View testID="circle-screen-loading">
        <Text style={styles.empty}>{t('circle.screen.loading')}</Text>
      </View>
    );
  }
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return (
      <View testID="circle-screen-empty">
        <Text style={styles.empty}>{t('circle.screen.empty')}</Text>
      </View>
    );
  }
  return (
    <View testID="circle-screen">
      {/* δ.1 — refresh pip shown when rendering cached blocks while a
         fresh materialize runs in the background.  Static glyph; muted
         tone so it doesn't compete with the page body. */}
      {refreshing ? (
        <Text
          style={styles.refreshing}
          accessibilityLabel={t('circle.screen.refreshing')}
          testID="circle-screen-refreshing"
        >
          {`⟳ ${t('circle.screen.refreshing')}`}
        </Text>
      ) : null}
      {blocks.map((block) => (
        <BlockSection key={block.blockId} block={block} onAction={onAction} onEmbedOpen={onEmbedOpen}
          highlightRef={highlightRef} highlightRowRef={highlightRowRef} onHighlightLayout={onHighlightLayout} />
      ))}
    </View>
  );
}

function BlockSection({ block, onAction, onEmbedOpen, highlightRef, highlightRowRef = null, onHighlightLayout = null }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const baseStyle = [styles.block, styles[`block_${block.type}`] ?? null];

  if (block.status === 'error') {
    return (
      <View style={[...baseStyle, styles.blockError]} testID={`screen-block-${block.blockId}`}>
        <Text style={styles.blockErrorText}>
          {t('circle.screen.block_error', { type: block.type })}{block.error ? ` — ${block.error}` : ''}
        </Text>
      </View>
    );
  }
  if (block.status === 'empty') {
    return (
      <View style={[...baseStyle, styles.blockEmpty]} testID={`screen-block-${block.blockId}`}>
        <Text style={styles.blockEmptyText}>{t('circle.screen.block_empty', { type: block.type })}</Text>
      </View>
    );
  }

  let body = null;
  switch (block.type) {
    case 'quickActions': body = renderQuickActions(block, onAction, styles); break;
    case 'announcement': body = renderAnnouncement(block, styles); break;
    case 'text':         body = renderText(block, styles); break;
    case 'photo':        body = renderPhoto(block, styles); break;
    case 'noticeboard':  body = renderNoticeboard(block, styles); break;
    case 'agenda':       body = renderAgenda(block, highlightRef, highlightRowRef, onHighlightLayout, styles); break;
    case 'tasks':        body = renderTasks(block, onEmbedOpen, highlightRef, highlightRowRef, onHighlightLayout, styles); break;
    case 'rules':        body = renderRules(block, styles); break;
    default:
      body = <Text style={styles.blockEmptyText}>{t('circle.screen.block_unknown', { type: block.type })}</Text>;
  }
  return <View style={baseStyle} testID={`screen-block-${block.blockId}`}>{body}</View>;
}

/* ─────────────────────────────────────────────────────────────────────── */

// D1 (§5A) — "Veel-gebruikt" pill row.  Each action is a feature key;
// a tap calls `onAction(key)` so the host can switch to that surface.
function renderQuickActions(block, onAction, styles) {
  const actions = (block.content?.actions ?? []).filter((a) => a?.key);
  return (
    <View style={styles.quickActionsRow}>
      {actions.map((a) => (
        <TouchableOpacity
          key={a.key}
          style={styles.quickAction}
          disabled={typeof onAction !== 'function'}
          onPress={() => onAction?.(a.key)}
          testID={`quick-action-${a.key}`}
        >
          <Text style={styles.quickActionText}>{t(featureActionLabelKey(a.key))}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function renderAnnouncement(block, styles) {
  const isCompact = block.config?.compact === true;
  return (
    <Text style={isCompact ? styles.announcementCompact : styles.announcement}>
      {block.content?.text ?? ''}
    </Text>
  );
}

function renderText(block, styles) {
  return <Text style={styles.text}>{block.content?.text ?? ''}</Text>;
}

function renderPhoto(block, styles) {
  const src = block.content?.src ?? '';
  const caption = (block.content?.caption ?? '').trim();
  return (
    <View>
      <Image
        source={{ uri: src }}
        accessibilityLabel={caption}
        style={styles.photo}
        resizeMode="cover"
      />
      {caption ? <Text style={styles.photoCaption}>{caption}</Text> : null}
    </View>
  );
}

function renderNoticeboard(block, styles) {
  const items = block.content?.items ?? [];
  const isCompact = block.config?.compact === true;
  const rowStyle    = isCompact ? styles.noticeRowCompact    : styles.noticeRow;
  const senderStyle = isCompact ? styles.noticeSenderCompact : styles.noticeSender;
  const textStyle   = isCompact ? styles.noticeTextCompact   : styles.noticeText;
  return (
    <View>
      <Text style={styles.blockTitle}>{t('circle.recipe.block.noticeboard')}</Text>
      {items.map((row) => {
        // Stamped by `materializeNoticeboard` through the reveal ladder (batch 4) — paint only.
        const sender = row?.senderSelf
          ? null
          : (row?.senderLabel ?? (row?.senderLabelKey ? t(row.senderLabelKey) : null));
        const text   = pickRowText(row);
        return (
          <View key={row.id ?? Math.random().toString(36)} style={rowStyle}>
            {sender ? <Text style={senderStyle}>{sender}</Text> : null}
            <Text style={textStyle}>{text}</Text>
          </View>
        );
      })}
    </View>
  );
}

function renderAgenda(block, highlightRef, highlightRowRef = null, onHighlightLayout = null, styles) {
  const items = block.content?.items ?? [];
  const isCompact = block.config?.compact === true;
  const rowStyle   = isCompact ? styles.agendaRowCompact   : styles.agendaRow;
  const labelStyle = isCompact ? styles.agendaLabelCompact : styles.agendaLabel;
  return (
    <View>
      <Text style={styles.blockTitle}>{t('circle.recipe.block.agenda')}</Text>
      {items.map((ev) => {
        // S6.B — a chip-tap referenced this row: highlight it AND (now) scroll to
        // it.  The hit row carries the parent's ref + fires onHighlightLayout once
        // native layout settles; the panel measures the ref and scrolls to it.
        const hit = matchesHighlight(ev.id, highlightRef);
        return (
          <View
            key={ev.id ?? Math.random().toString(36)}
            ref={hit ? highlightRowRef : undefined}
            onLayout={hit && onHighlightLayout ? () => onHighlightLayout() : undefined}
            style={hit ? [rowStyle, styles.rowHighlight] : rowStyle}
          >
            <Text style={labelStyle}>{ev.label ?? ''}</Text>
          </View>
        );
      })}
    </View>
  );
}

function renderTasks(block, onEmbedOpen, highlightRef, highlightRowRef = null, onHighlightLayout = null, styles) {
  const items = block.content?.items ?? [];
  const isCompact = block.config?.compact === true;
  const rowStyle    = isCompact ? styles.taskRowCompact    : styles.taskRow;
  const circleStyle = isCompact ? styles.taskCircleCompact : styles.taskCircle;
  const textStyle   = isCompact ? styles.taskTextCompact   : styles.taskText;
  return (
    <View>
      <Text style={styles.blockTitle}>{t('circle.recipe.block.tasks')}</Text>
      {items.map((task) => {
        const embeds = embedChipsOf(task);
        // S6.B — a chip-tap referenced this row: highlight it AND (now) scroll to
        // it.  The hit row carries the parent's ref + fires onHighlightLayout once
        // native layout settles; the panel measures the ref and scrolls to it.
        const hit = matchesHighlight(task.id, highlightRef);
        return (
          <View
            key={task.id ?? Math.random().toString(36)}
            ref={hit ? highlightRowRef : undefined}
            onLayout={hit && onHighlightLayout ? () => onHighlightLayout() : undefined}
            style={hit ? [rowStyle, styles.rowHighlight] : rowStyle}
          >
            {task.circleName ? <Text style={circleStyle}>{task.circleName}</Text> : null}
            <Text style={textStyle}>{task.text ?? ''}</Text>
            {embeds.length > 0 && (
              <View style={styles.embeds}>
                {embeds.map((e) => {
                  const typeKey = embedTypeLabelKey(e.type);
                  const typeLabel = t(typeKey);
                  const typeText = (typeLabel && typeLabel !== typeKey) ? typeLabel : e.type;
                  const screen = screenForEmbedType(e.type);
                  const tappable = !!(screen && !e.locked && typeof onEmbedOpen === 'function');
                  const label = `${e.icon} ${typeText}: ${e.label ?? shortRef(e.ref)}`;
                  return tappable ? (
                    <Pressable key={e.ref} style={styles.embed} testID={`task-embed-${e.ref}`}
                      onPress={() => onEmbedOpen({ type: e.type, ref: e.ref, screen })}>
                      <Text style={styles.embedText}>{label}</Text>
                    </Pressable>
                  ) : (
                    <View key={e.ref} style={styles.embed} testID={`task-embed-${e.ref}`}>
                      <Text style={styles.embedText}>{label}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function renderRules(block, styles) {
  const doc = block.content?.doc ?? {};
  const fields = ['purpose', 'admins', 'agreements', 'conflict', 'admission', 'leaving', 'responsibility'];
  return (
    <View>
      <Text style={styles.blockTitle}>{t('circle.recipe.block.rules')}</Text>
      {fields.map((f) => {
        const value = (doc[f] ?? '').trim();
        if (!value) return null;
        return (
          <View key={f} style={styles.rulesField}>
            <Text style={styles.rulesLabel}>{t(`circle.rules.field.${f}`)}</Text>
            <Text style={styles.rulesValue}>{value}</Text>
          </View>
        );
      })}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function pickRowText(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of ['text', 'title', 'body', 'name', 'message']) {
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  return '';
}

const makeStyles = (theme) => StyleSheet.create({
  empty:           { color: theme.color.inkSoft, fontStyle: 'italic', textAlign: 'center', paddingVertical: 24, paddingHorizontal: 12 },
  // δ.1 — refresh pip: muted, small, right-aligned above the block list.
  refreshing:      { color: theme.color.inkSoft, fontSize: 11, opacity: 0.6, textAlign: 'right', marginBottom: 4 },
  block:           { padding: 14, marginBottom: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: 10, backgroundColor: theme.color.card },
  // D1 (§5A) — "Veel-gebruikt" pill row.
  quickActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickAction:     { paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: theme.color.line, borderRadius: 999, backgroundColor: theme.color.paper2 },
  quickActionText: { fontSize: 13, fontWeight: '600', color: theme.color.ink },
  blockEmpty:      { backgroundColor: theme.color.paper2, borderColor: theme.color.line },
  blockEmptyText:  { color: theme.color.inkSoft, fontStyle: 'italic', fontSize: 13 },
  blockError:      { borderColor: theme.color.accent, backgroundColor: theme.color.paper2 },
  blockErrorText:  { color: theme.color.accentInk, fontSize: 13 },
  blockTitle:     { fontSize: 11, fontWeight: '700', color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 8 },

  announcement:    { fontFamily: theme.font.serif, fontSize: 18, color: theme.color.ink, lineHeight: 24 },
  // α.5c — compact variant for list-shaped blocks (toggled via block.config.compact).
  announcementCompact: { fontFamily: theme.font.serif, fontSize: 14, color: theme.color.ink, lineHeight: 18 },
  text:            { fontSize: 14, color: theme.color.ink, lineHeight: 20 },

  photo:           { width: '100%', aspectRatio: 16 / 9, borderRadius: 6, backgroundColor: theme.color.paper2 },
  photoCaption:    { fontSize: 12, color: theme.color.inkSoft, marginTop: 6 },

  noticeRow:        { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  noticeRowCompact: { paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  noticeSender:        { fontSize: 11, color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  noticeSenderCompact: { fontSize: 10, color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 1 },
  noticeText:          { fontSize: 14, color: theme.color.ink },
  noticeTextCompact:   { fontSize: 12, color: theme.color.ink, lineHeight: 16 },

  agendaRow:           { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  agendaRowCompact:    { paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  agendaLabel:         { fontSize: 14, color: theme.color.ink },
  agendaLabelCompact:  { fontSize: 12, color: theme.color.ink, lineHeight: 16 },

  taskRow:             { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  taskRowCompact:      { paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: theme.color.line, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  taskCircle:          { fontSize: 10, fontWeight: '700', color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, flexShrink: 0 },
  taskCircleCompact:   { fontSize: 9,  fontWeight: '700', color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 },
  taskText:            { fontSize: 14, color: theme.color.ink, flex: 1 },
  taskTextCompact:     { fontSize: 12, color: theme.color.ink, flex: 1, lineHeight: 16 },
  // S6.B — accent-tinted background flashed on the row a "See also" chip
  // referenced.  Subtle terracotta wash (RN has no CSS @keyframes; a static
  // tint is the v1 — the panel re-renders fresh on each chip tap).
  rowHighlight:        { backgroundColor: 'rgba(176, 74, 48, 0.16)', borderRadius: 6 },
  // embeds[] — "See also" chips on a task card.
  embeds:              { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 3, flexBasis: '100%' },
  embed:               { borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.card, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 8 },
  embedText:           { fontSize: 11, color: theme.color.ink },

  rulesField:      { marginBottom: 10 },
  rulesLabel:      { fontSize: 11, fontWeight: '700', color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  rulesValue:      { fontSize: 14, color: theme.color.ink, lineHeight: 20 },
});
