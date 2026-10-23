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
import { blockEmptyLine, blockOpensWhole } from '../../../../basis/src/v2/blockTitle.js';
import { agendaGroups, taskGroups } from '../../../../basis/src/v2/dayShape.js';
import React, { useMemo, useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Pressable, TextInput } from 'react-native';
import { featureActionLabelKey } from '@onderling-app/basis';
import { embedChipsOf, embedTypeLabelKey, shortRef, screenForEmbedType } from '../../../../basis/src/v2/embedChips.js';
import { useTheme } from './themeContext.js';
import Btn from './Btn.js';
import { t } from '../../core/localisation.js';
import { identityLineWords, agentRowWords } from '../../../../basis/src/v2/mijWords.js';
import { dateLocaleOf } from '../../../../basis/src/v2/whenWords.js';
import { whereTag } from '../../../../basis/src/v2/rowWhere.js';
import { nounHeading } from '../../../../basis/src/v2/nounNames.js';

// An embed `ref` may be a full URN (urn:dec:item:T2) while a rendered row
// carries only the local id (T2).  Match the raw ref OR its local-id tail so a
// chip tap can find its row regardless of which form each side holds.
function matchesHighlight(rowId, highlightRef) {
  if (!rowId || !highlightRef) return false;
  return rowId === highlightRef || String(highlightRef).endsWith(String(rowId));
}

export default function CircleScreenView({ blocks = null, refreshing = false, onAction, onEmbedOpen, highlightRef, highlightRowRef = null, onHighlightLayout = null, onMore = null }) {
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
        <BlockSection key={block.blockId} block={block} onAction={onAction} onEmbedOpen={onEmbedOpen} onMore={onMore}
          highlightRef={highlightRef} highlightRowRef={highlightRowRef} onHighlightLayout={onHighlightLayout} />
      ))}
    </View>
  );
}

// A block that carries its own title (`titleKey` — the Mij overview's "Mijn dingen" / "Mijn agenda") is called by it;
// any other block by its type, as before (web: circleScreen.js).
function blockName(block) {
  return block.titleKey ? t(block.titleKey) : block.type;
}

function BlockSection({ block, onAction, onEmbedOpen, highlightRef, highlightRowRef = null, onHighlightLayout = null, onMore = null }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const baseStyle = [styles.block, styles[`block_${block.type}`] ?? null];

  if (block.status === 'error') {
    return (
      <View style={[...baseStyle, styles.blockError]} testID={`screen-block-${block.blockId}`}>
        <Text style={styles.blockErrorText}>
          {t('circle.screen.block_error', { type: blockName(block) })}{block.error ? ` — ${block.error}` : ''}
        </Text>
      </View>
    );
  }
  // the onboarding strip, all its cards done: nothing at all (not a line saying so)
  if (block.type === 'onboarding' && block.status === 'empty') return null;
  if (block.status === 'empty') {
    return (
      <View style={[...baseStyle, styles.blockEmpty]} testID={`screen-block-${block.blockId}`}>
        <Text style={styles.blockEmptyText}>{blockEmptyLine(block, t)}</Text>
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
    case 'calendar':       body = renderAgenda(block, highlightRef, highlightRowRef, onHighlightLayout, styles, onAction); break;
    case 'tasks':        body = renderTasks(block, onEmbedOpen, highlightRef, highlightRowRef, onHighlightLayout, styles, onAction); break;
    // ONE block for any item type across circles: chores and appointments in their own painters, any other type a list
    case 'items':
      if (block.content?.noun === 'task') body = renderTasks(block, onEmbedOpen, highlightRef, highlightRowRef, onHighlightLayout, styles, onAction);
      else if (block.content?.noun === 'calendar-event') body = renderAgenda(block, highlightRef, highlightRowRef, onHighlightLayout, styles, onAction);
      else body = renderItems(block, styles, onAction);
      break;
    case 'rules':        body = renderRules(block, styles); break;
    case 'circlesUnread': body = renderCirclesUnread(block, onAction, styles); break;
    case 'awaiting':      body = renderAwaiting(block, onAction, styles); break;
    case 'onboarding':   body = <OnboardingCards block={block} onAction={onAction} styles={styles} />; break;
    case 'identityLine': body = renderIdentityLine(block, onAction, styles); break;
    case 'agents':       body = renderAgents(block, onAction, styles); break;
    default:
      body = <Text style={styles.blockEmptyText}>{t('circle.screen.block_unknown', { type: block.type })}</Text>;
  }
  return (
    <View style={baseStyle} testID={`screen-block-${block.blockId}`}>
      {body}
      {/* a capped block on the person's pages: "meer" opens it whole (the host's `onMore(blockId)`) */}
      {typeof onMore === 'function' && blockOpensWhole(block) ? (
        <Pressable onPress={() => onMore(block.blockId)} testID={`screen-more-${block.blockId}`}>
          <Text style={styles.moreLink}>{t('circle.screen.more')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
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

// The circles with news: each a row with its name and how many unread; a tap opens the circle
// (`onAction({ kind: 'open-circle', circleId })`, the same act the launcher's tile does). Web parity: circleScreen.js.
// Mij's "wat wacht op jou": one chip per waiting thing, each OPENING where it lives (shared awaiting.js; web parity:
// circleScreen.js renderAwaiting) — nothing acts here.
function renderAwaiting(block, onAction, styles) {
  const items = block.content?.items ?? [];
  return (
    <View>
      <Text style={styles.blockTitle}>{t('circle.recipe.block.awaiting')}</Text>
      {items.map((it) => (
        <Pressable key={`${it.kind}-${it.circleId ?? ''}`} style={styles.noticeRow} testID={`awaiting-${it.kind}-${it.circleId ?? 'here'}`}
          disabled={typeof onAction !== 'function'} onPress={() => onAction?.({ ...it.open })}>
          <Text style={styles.noticeText}>{t(it.labelKey, { count: it.count, name: it.name ?? '' })}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function renderCirclesUnread(block, onAction, styles) {
  const items = block.content?.items ?? [];
  return (
    <View>
      <Text style={styles.blockTitle}>{t('circle.recipe.block.circlesUnread')}</Text>
      {items.map((row) => (
        <Pressable key={row.circleId} style={styles.noticeRow} testID={`circles-unread-${row.circleId}`}
          disabled={typeof onAction !== 'function'}
          onPress={() => onAction?.({ kind: 'open-circle', circleId: row.circleId })}>
          <Text style={styles.noticeText}>{row.name ?? row.circleId} · {t('circle.screen.unread_count', { count: row.unread })}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// Me's identity line: the name as the page's title, "Edit" beside it (`onAction({ kind: 'edit-me' })`, the person's
// own editor), the readings below in one line, worded by the shared helper. Web parity: circleScreen.js.
function renderIdentityLine(block, onAction, styles) {
  const words = identityLineWords(block.content, { t, locale: dateLocaleOf(t) });
  return (
    <View>
      <View style={styles.identityHead}>
        <Text style={styles.identityName} testID="mij-name">{block.content?.name || t('circle.profile.title')}</Text>
        {typeof onAction === 'function' ? (
          <Pressable onPress={() => onAction({ kind: 'edit-me' })} accessibilityRole="button" testID="mij-edit">
            <Text style={styles.identityEdit}>{t('circle.profile.edit')}</Text>
          </Pressable>
        ) : null}
      </View>
      {words.length ? <Text style={styles.noticeText} testID="mij-readings">{words.join(' · ')}</Text> : null}
    </View>
  );
}

// Me's agents and devices: one sentence a row, read-only; a tap opens My data (`onAction({ kind: 'open-my-data' })`).
function renderAgents(block, onAction, styles) {
  const items = block.content?.items ?? [];
  return (
    <View>
      <Text style={styles.blockTitle}>{t('circle.recipe.block.agents')}</Text>
      {items.map((row, i) => (
        <Pressable key={`${row.kind}-${i}`} style={styles.noticeRow} testID={`mij-agent-${row.kind}`}
          disabled={typeof onAction !== 'function'}
          onPress={() => onAction?.({ kind: 'open-my-data' })}>
          <Text style={styles.noticeText}>{agentRowWords(row, t)}</Text>
        </Pressable>
      ))}
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

// A row is a CARD with ONE button: the action its noun declares (`item.primary`, the shared `primaryActionFor`) — done
// (an op through the waist), open the "+" sheet on it, or open its circle. Web twin: circleScreen.js `primaryButton`.
function PrimaryButton({ item, noun, onAction, styles }) {
  const p = item?.primary;
  if (!p || typeof onAction !== 'function') return null;
  const go = () => {
    if (p.kind === 'op') onAction({ kind: 'row-op', op: { app: p.app, opId: p.opId, args: p.args } });
    else if (p.kind === 'edit-own') onAction({ kind: 'edit-own', noun, item });
    else if (p.kind === 'open-circle') onAction({ kind: 'open-circle', circleId: p.circleId });
  };
  return (
    <Pressable style={styles.rowAct} onPress={go} accessibilityRole="button" testID={`row-act-${item.id}`}>
      <Text style={styles.rowActText}>{t(p.labelKey)}</Text>
    </Pressable>
  );
}

// An OWN row (no circle) opens the "+" sheet on itself — change it or take it away (`onAction({ kind: 'edit-own' })`);
// a circle's row stays the circle's. Web twin: circleScreen.js `openableOwn`.
const OwnRow = React.forwardRef(function OwnRow({ item, noun, onAction, style, children, ...rest }, ref) {
  if (!item?.own || typeof onAction !== 'function') return <View ref={ref} style={style} {...rest}>{children}</View>;
  return (
    <Pressable ref={ref} style={style} accessibilityRole="button" onPress={() => onAction({ kind: 'edit-own', noun, item })}
      testID={`own-row-${item.id}`} {...rest}>
      {children}
    </Pressable>
  );
});

// THE ONBOARDING STRIP: the cards left (handle · what Basis is · begin), each with its own act through the host.
// Web twin: circleScreen.js `renderOnboarding`.
function OnboardingCards({ block, onAction, styles }) {
  const [handle, setHandle] = useState('');
  const act = (a) => { if (typeof onAction === 'function') onAction(a); };
  // the family (Btn): the strip's act is the screen's primary, the second choice quiet
  const OnbBtn = ({ labelKey, a, quiet = false, variant = null, testID }) => (
    <Btn variant={variant ?? (quiet ? 'quiet' : 'primary')} label={t(labelKey)} onPress={() => act(a)} testID={testID} style={{ alignSelf: 'flex-start' }} />
  );
  return (
    <View>
      {(block.content?.cards ?? []).map((c) => (
        <View key={c.id} style={styles.onbCard} testID={`onb-card-${c.id}`}>
          <Text style={styles.onbTitle}>{t(`circle.vandaag.onboarding_${c.id}_title`)}</Text>
          {c.id === 'handle' ? (
            <View>
              <Text style={styles.onbLine}>{t('circle.vandaag.onboarding_handle_hint')}</Text>
              <TextInput style={styles.onbInput} value={handle} onChangeText={setHandle} placeholder={t('circle.vandaag.onboarding_handle_ph')}
                accessibilityLabel={t('circle.vandaag.onboarding_handle_title')} testID="onb-handle" />
              <OnbBtn labelKey="circle.vandaag.onboarding_handle_save" a={{ kind: 'set-handle', value: handle }} testID="onb-handle-save" />
            </View>
          ) : c.id === 'key' ? (
            // never the words themselves: the card says the key is not saved, and its "Toon" opens them
            <View>
              <Text style={styles.onbLine}>{t('circle.vandaag.onboarding_key_hint')}</Text>
              <View style={styles.onbRow}>
                <OnbBtn labelKey="circle.vandaag.onboarding_key_show" a={{ kind: 'key-show' }} testID="onb-key-show" />
                <OnbBtn labelKey="circle.vandaag.onboarding_key_later" a={{ kind: 'key-later' }} quiet testID="onb-key-later" />
              </View>
            </View>
          ) : c.id === 'intro' ? (
            <View>
              {['onboarding_intro_1', 'onboarding_intro_2', 'onboarding_intro_3'].map((k) => <Text key={k} style={styles.onbLine}>{t(`circle.vandaag.${k}`)}</Text>)}
              <View style={styles.onbRow}>
                <OnbBtn labelKey="circle.vandaag.onboarding_intro_more" a={{ kind: 'intro-more' }} testID="onb-intro-more" />
                {/* "Lees meer" is the card's one button; "Begrepen" a text link beside it */}
                <OnbBtn labelKey="circle.vandaag.onboarding_intro_dismiss" a={{ kind: 'intro-seen' }} variant="ghost" testID="onb-intro-seen" />
              </View>
            </View>
          ) : (
            <View style={styles.onbRow}>
              <OnbBtn labelKey="circle.vandaag.onboarding_begin_create" a={{ kind: 'create-circle' }} testID="onb-create" />
              <OnbBtn labelKey="circle.vandaag.onboarding_begin_join" a={{ kind: 'join-circle' }} quiet testID="onb-join" />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

// A folded group (the day's shape): its heading with the count, open or folded by a tap. Web twin: <details>.
function Group({ label, open: openAtFirst, styles, testID, children }) {
  const [open, setOpen] = useState(!!openAtFirst);
  return (
    <View testID={testID}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={styles.groupHead}>{`${open ? '▾' : '▸'} ${label}`}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

function renderAgenda(block, highlightRef, highlightRowRef = null, onHighlightLayout = null, styles, onAction = null) {
  const isCompact = block.config?.compact === true;
  const rowStyle   = isCompact ? styles.agendaRowCompact   : styles.agendaRow;
  const labelStyle = isCompact ? styles.agendaLabelCompact : styles.agendaLabel;
  const rowOf = (ev) => {
    // S6.B — a chip-tap referenced this row: highlight it AND (now) scroll to
    // it.  The hit row carries the parent's ref + fires onHighlightLayout once
    // native layout settles; the panel measures the ref and scrolls to it.
    const hit = matchesHighlight(ev.id, highlightRef);
    return (
      <OwnRow
        key={ev.id ?? Math.random().toString(36)}
        item={ev} noun="calendar-event" onAction={onAction}
        ref={hit ? highlightRowRef : undefined}
        onLayout={hit && onHighlightLayout ? () => onHighlightLayout() : undefined}
        style={hit ? [rowStyle, styles.rowHighlight] : rowStyle}
      >
        {ev.moment ? <Text style={styles.agendaMoment}>{ev.moment}</Text> : null}
        <Text style={labelStyle}>{whereTag(ev, t) ? `${whereTag(ev, t)} · ` : ''}{(ev.moment ? ev.title : null) || ev.label || ''}</Text>
        <PrimaryButton item={ev} noun="calendar-event" onAction={onAction} styles={styles} />
      </OwnRow>
    );
  };
  // THE DAY'S SHAPE: now · soon · later today · tomorrow · after — the first group open, the rest folded
  const groups = agendaGroups(block.content?.items ?? [], { t, locale: dateLocaleOf(t) });
  return (
    <View>
      <Text style={styles.blockTitle}>{t(block.titleKey ?? 'circle.recipe.block.calendar')}</Text>
      {groups.map((g) => (
        <Group key={g.key} label={`${t(g.labelKey)} (${g.items.length})`} open={g.open} styles={styles} testID={`agenda-group-${g.key}`}>
          {g.items.map(rowOf)}
        </Group>
      ))}
    </View>
  );
}

/** Rows of any item type across circles: the presenter's label, and which circle it is in. */
function renderItems(block, styles, onAction = null) {
  const items = block.content?.items ?? [];
  return (
    <View>
      <Text style={styles.blockTitle}>{block.titleKey ? t(block.titleKey) : nounHeading(t, block.content?.noun ?? '')}</Text>
      {items.map((it) => (
        <OwnRow key={it.id ?? Math.random().toString(36)} item={it} noun={block.content?.noun ?? null} onAction={onAction} style={styles.agendaRow}>
          <Text style={styles.agendaLabel}>{whereTag(it, t) ? `${whereTag(it, t)} · ` : ''}{it.label ?? ''}</Text>
          <PrimaryButton item={it} noun={block.content?.noun ?? null} onAction={onAction} styles={styles} />
        </OwnRow>
      ))}
    </View>
  );
}

function renderTasks(block, onEmbedOpen, highlightRef, highlightRowRef = null, onHighlightLayout = null, styles, onAction = null) {
  const items = block.content?.items ?? [];
  const isCompact = block.config?.compact === true;
  const rowStyle    = isCompact ? styles.taskRowCompact    : styles.taskRow;
  const circleStyle = isCompact ? styles.taskCircleCompact : styles.taskCircle;
  const textStyle   = isCompact ? styles.taskTextCompact   : styles.taskText;
  return (
    <View>
      <Text style={styles.blockTitle}>{t(block.titleKey ?? 'circle.recipe.block.tasks')}</Text>
      {taskGroups(items).open.map((task) => {
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
            {whereTag(task, t) ? <Text style={circleStyle}>{whereTag(task, t)}</Text> : null}
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
            <PrimaryButton item={task} noun="task" onAction={onAction} styles={styles} />
          </View>
        );
      })}
      {/* the done chores, folded under "gedaan (n)" */}
      {taskGroups(items).done.length ? (
        <Group label={t('circle.vandaag.tasks_done', { count: taskGroups(items).done.length })} open={false} styles={styles} testID="tasks-done">
          {taskGroups(items).done.map((task) => (
            <View key={task.id ?? Math.random().toString(36)} style={rowStyle}>
              <Text style={textStyle}>{task.text ?? ''}</Text>
            </View>
          ))}
        </Group>
      ) : null}
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
  // an empty block is one quiet line of text, not a grey box that reads as disabled (web twin: --empty in circle.css)
  blockEmpty:      { backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 4, paddingHorizontal: 0 },
  blockEmptyText:  { color: theme.color.inkSoft, fontSize: 14 },
  // "meer" under a capped block: a quiet text link (web: .circle-screen__more)
  moreLink:        { color: theme.color.inkSoft, fontSize: 13, textDecorationLine: 'underline', paddingVertical: 2 },
  blockError:      { borderColor: theme.color.accent, backgroundColor: theme.color.paper2 },
  blockErrorText:  { color: theme.color.accentInk, fontSize: 13 },
  // "Edit" beside the name, as on web (`.cc-mij__head`): at the far edge it sat under the header avatar
  identityHead:   { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
  identityName:   { fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink },
  identityEdit:   { fontSize: 14, fontWeight: '600', color: theme.color.accent },
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

  // a row is a CARD: the words, and ONE button (the action its noun declares)
  agendaRow:           { paddingVertical: 8, paddingHorizontal: 10, marginVertical: 3, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, flexDirection: 'row', alignItems: 'center', gap: 8 },
  agendaRowCompact:    { paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  agendaLabel:         { fontSize: 14, color: theme.color.ink, flex: 1 },
  agendaLabelCompact:  { fontSize: 12, color: theme.color.ink, lineHeight: 16 },

  taskRow:             { paddingVertical: 8, paddingHorizontal: 10, marginVertical: 3, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  onbCard:             { padding: 12, marginVertical: 4, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card },
  onbTitle:            { fontSize: 15, fontWeight: '700', color: theme.color.ink, marginBottom: 6 },
  onbLine:             { fontSize: 13, color: theme.color.inkSoft, marginBottom: 4 },
  onbInput:            { fontSize: 14, paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: theme.color.line, borderRadius: 6, color: theme.color.ink, backgroundColor: theme.color.paper, marginVertical: 6 },
  onbRow:              { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  groupHead:           { fontSize: 13, color: theme.color.inkSoft, paddingVertical: 4 },
  agendaMoment:        { fontSize: 13, color: theme.color.inkSoft },
  // a row's own act ("Change"): a quiet text button — the page's one accent is the "+"
  rowAct:              { paddingVertical: 4, paddingHorizontal: 6, marginLeft: 'auto' },
  rowActText:          { fontSize: 13, color: theme.color.inkSoft },
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
