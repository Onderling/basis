/**
 * basis-mobile v2 — circle noticeboard / noticeboard (RN, S1 #1 parity).
 *
 * RN mirror of web's `circleNoticeboard.js`: the circle noticeboard inside a
 * circle's NOTICEBOARD tab — an ask/offer/lend composer and the open-post list with
 * per-row actions. Self-contained: loads `listOpen` and dispatches `postRequest`/
 * `respondToItem`/`cancelRequest`/`reportPost`/`markReturned` via the injected
 * `callSkill` (the same already-wired stoop ops). Shows the shared circle's posts
 * (one stoop agent today); per-circle scoping arrives with the pod foundation.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, Image, Modal } from 'react-native';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { pickAndEncodeImage } from '../../v2/attachmentPicker.js';
// embeds[] — cross-object reference chips ("See also"), shared with web.
import { embedChipsOf, embedTypeLabelKey, shortRef, screenForEmbedType } from '../../../../basis/src/v2/embedChips.js';
import { enrichEmbedsWithTitles } from '../../../../basis/src/v2/embedResolve.js';
import { isNoticeboardPost } from '../../../../basis/src/v2/circleStoopScope.js';
import { replyToPost } from '../../../../basis/src/v2/replyToPost.js';
import { annotateResonantPosts } from '../../../../basis/src/core/handlers/driverMatchNotify.js';
import { getCirclePodFetch } from '../../core/circlePods.js';
// Sealed media (2026-07-11): Uint8Array → base64 data-URL for the full-image viewer (reuse the
// RN media-card helper — no second encoder).
import { bytesToStdB64 } from '../../core/mediaCardModel.js';

const INTENTS = ['ask', 'offer', 'lend'];

// `media` — THIS circle's sealed-media composition (or null for a p0/p1 circle). Threaded from
// CircleLauncherScreen (web parity `circleMedia`): gates the 📎 attach affordance (sealed-only —
// hidden when null) and opens sealed full images through the per-circle gateway on tap.
export default function CircleNoticeboard({ callSkill, onStoopEvent, onEmbedOpen, media = null, onReportPost = null, onPeerMuted = null, contactChannel = null, onReplied = null }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [posts, setPosts] = useState([]);
  const [intent, setIntent] = useState('ask');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [myWebid, setMyWebid] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [dueText, setDueText] = useState('');   // S3 #4 — lend return-by date (YYYY-MM-DD)
  const [assigningTo, setAssigningTo] = useState(null);   // S3 #4 — lender assigns a borrower
  const [assignText, setAssignText] = useState('');
  const [attachment, setAttachment] = useState(null);   // S5 — pending image attachment
  const [viewing, setViewing] = useState(null);         // S5 — { uri, pending } full-image viewer

  // embeds[] — resolve each post's embed refs to live titles (best-effort), then
  // re-set so the "See also" chips upgrade from a ref to the real title.
  const enrichEmbeds = useCallback(async (posts) => {
    try {
      const out = await Promise.all(posts.map(async (p) => {
        if (!Array.isArray(p.embeds) || !p.embeds.length) return p;
        const enriched = await enrichEmbedsWithTitles({ callSkill, embeds: p.embeds, fetchImpl: getCirclePodFetch() || undefined });
        return enriched.some((e) => e && e.title) ? { ...p, embeds: enriched } : p;
      }));
      setPosts(out);
    } catch { /* best-effort */ }
  }, [callSkill]);

  const reload = useCallback(async () => {
    if (typeof callSkill !== 'function') return;
    let who = myWebid;
    if (who == null) { try { const r = await callSkill('stoop', 'whoAmI', {}); who = r?.webid ?? r?.webId ?? ''; } catch { who = ''; } setMyWebid(who); }
    try {
      const res = await callSkill('stoop', 'listOpen', {});
      // Keep only real asks/offers — listOpen (no intent) also returns system items
      // (rules / membership) which aren't noticeboard posts.
      const items = (Array.isArray(res?.items) ? res.items : []).filter(isNoticeboardPost);
      const mapped = items.map((it) => ({
        // The INTENT, not the item type — a canonical post's type is 'post', which printed the raw
        // locale key as its badge on both shells (web≡mobile with circleApp's projection).
        id: it.id, text: it.text ?? it.label ?? '',
        type: it.intent ?? it.kind ?? (['ask', 'offer', 'lend'].includes(it.type) ? it.type : 'ask'),
        addedBy: it.addedBy, mine: !!(who && it.addedBy === who),
        // S5 — inline-image metadata (thumbnail travels; full bytes on demand).
        attachments: Array.isArray(it.attachments) ? it.attachments
          : (Array.isArray(it.source?.attachments) ? it.source.attachments : []),
        // embeds[] — cross-object references (a post → a task / event / post).
        embeds: Array.isArray(it.embeds) ? it.embeds
          : (Array.isArray(it.source?.embeds) ? it.source.embeds : []),
        // Drivers #5 — carry the matching signal for the render-time driver match.
        driverSignature: it.driverSignature ?? it.source?.driverSignature ?? null,
        skillTags: Array.isArray(it.source?.skillTags) ? it.source.skillTags : (Array.isArray(it.skillTags) ? it.skillTags : []),
        requiredSkills: Array.isArray(it.requiredSkills) ? it.requiredSkills : [],
      }));
      // Drivers #5 (b) — flag posts that resonate with my private drivers (on-device); the existing
      // "respond" chip on a flagged post IS the anonymous reach-out. Best-effort.
      let annotated = mapped;
      try {
        annotated = await annotateResonantPosts({
          posts: mapped,
          getDrivers: async () => (await callSkill('agents', 'getProfileDrivers', { id: 'default' }))?.drivers ?? {},
        });
      } catch { /* resonance is a nicety; never block the board */ }
      setPosts(annotated);
      // embeds[] — progressively resolve each ref to a live title, then re-set
      // to upgrade the "See also" chips (ref → real title). Best-effort. Pass the
      // ANNOTATED posts so the resonance flag survives the embed re-set.
      enrichEmbeds(annotated);
    } catch { setPosts([]); }
  }, [callSkill, myWebid, enrichEmbeds]);

  useEffect(() => { reload(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // S6.4 — refresh when a recipient's requested attachment bytes arrive.
  useEffect(() => {
    if (typeof onStoopEvent !== 'function') return undefined;
    return onStoopEvent('stoop:attachment-fetched', () => { reload(); });
  }, [onStoopEvent, reload]);

  // S5 — pick + encode an image into the inbound-attachment shape, held pending.
  const attachImage = useCallback(async () => {
    try {
      const att = await pickAndEncodeImage();
      if (att) setAttachment(att);
    } catch { setError(true); }
  }, []);

  const submitPost = useCallback(async () => {
    const body = text.trim();
    if ((!body && !attachment) || typeof callSkill !== 'function') return;
    const dueAt = intent === 'lend' && dueText ? Date.parse(dueText) : undefined;
    const pending = attachment;
    setText(''); setDueText(''); setError(false); setBusy(true);
    try {
      await callSkill('stoop', 'postRequest', {
        intent, text: body,
        ...(Number.isFinite(dueAt) ? { dueAt } : {}),
        ...(pending ? { attachments: [pending] } : {}),
      });
      setAttachment(null);
    }
    catch { setError(true); }
    setBusy(false);
    reload();
  }, [text, intent, dueText, attachment, callSkill, reload]);

  // Sealed media (2026-07-11): open the full-size image by unsealing the blob through THIS circle's
  // media gateway (`openFullImage` → openBlob, gated + decrypted client-side) — the SAME read path
  // basis's own circle images use, and web's `noticeboardViewAttachment`. Stoop holds only the
  // opaque sealed pointer (no plaintext byte round-trip). The sealed thumbnail (already opened for the
  // chip by the wrapper) stands in on a wrong key / denial.
  const viewAttachment = useCallback(async (post, att) => {
    const line = att && att.source;
    if (media && line && typeof line === 'object' && line.enc) {
      try {
        const { bytes, media: meta } = await media.openFullImage(line);
        const mime = (meta && meta.mime) || att.mime || 'image/jpeg';
        setViewing({ uri: `data:${mime};base64,${bytesToStdB64(bytes)}`, pending: false });
        return;
      } catch { /* denied / wrong key → fall back to the sealed thumbnail below */ }
    }
    if (att && att.thumbnail) setViewing({ uri: att.thumbnail, pending: true });
  }, [media]);

  const runAction = useCallback(async (action, post) => {
    try {
      if (action === 'respond') { setReplyingTo(post.id); setReplyText(''); return; }
      if (action === 'assign') { setAssigningTo(post.id); setAssignText(''); return; }
      if (action === 'cancel') await callSkill('stoop', 'cancelRequest', { requestId: post.id });
      // §8 unification — a post report is now a governance report event (propagates + shows
      // in the governance Reports section), not the older reportPost item. Falls back if unwired.
      else if (action === 'report') { if (typeof onReportPost === 'function') onReportPost(post); else await callSkill('stoop', 'reportPost', { itemId: post.id }); }
      else if (action === 'markReturned') await callSkill('stoop', 'markReturned', { requestId: post.id });
      else if (action === 'mute' && post.addedBy) {
        // BLOCK the person — both halves, one act (web parity). Keyed on the webid, which is what
        // makes it a block of a PERSON rather than of one address.
        await callSkill('basis', 'mute', { peer: post.addedBy });
        try { onPeerMuted?.(); } catch { /* the chat hide-set refresh is best-effort */ }
      }
    } catch { /* reload reflects the real state */ }
    reload();
  }, [callSkill, reload, onPeerMuted]);

  const submitReply = useCallback(async (post) => {
    const body = replyText.trim();
    if (!body) { setReplyingTo(null); return; }
    // The reply starts a 1:1 conversation with the poster: persisted into their contact thread, and
    // the launcher opens that thread so the answer that comes back has a place to land (web parity).
    let r = null;
    try { r = await replyToPost({ callSkill, contactChannel, itemId: post.id, body }); } catch { /* */ }
    setReplyingTo(null); setReplyText('');
    reload();
    if (r?.ok && r.toPubKey) { try { onReplied?.(r); } catch { /* opening the thread is a courtesy */ } }
  }, [replyText, callSkill, contactChannel, onReplied, reload]);

  const submitAssign = useCallback(async (post) => {
    const borrowerWebid = assignText.trim();
    if (!borrowerWebid) { setAssigningTo(null); return; }
    try { await callSkill('stoop', 'assignLend', { itemId: post.id, borrowerWebid }); } catch { /* */ }
    setAssigningTo(null); setAssignText('');
    reload();
  }, [assignText, callSkill, reload]);

  return (
    <View style={styles.wrap} testID="circle-noticeboard">
      <View style={styles.intents}>
        {INTENTS.map((it) => (
          <Pressable key={it} style={[styles.intent, it === intent && styles.intentActive]} onPress={() => setIntent(it)} testID={`nb-intent-${it}`}>
            <Text style={[styles.intentText, it === intent && styles.intentTextActive]}>{t(`circle.noticeboard.intent.${it}`)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.composerRow}>
        <TextInput
          style={styles.input} value={text} onChangeText={setText}
          placeholder={t(`circle.noticeboard.placeholder.${intent}`)} placeholderTextColor={theme.color.inkSoft}
          onSubmitEditing={submitPost} testID="nb-input"
        />
        {/* Sealed-only: the 📎 shows ONLY when this circle has a media gateway (p2/p3). A p0/p1
            circle resolves no composition → `media` null → NO attach button (web parity
            `circleMedia ? ... : null`), so a user never picks an image only to hit the wrapper's
            sealed-only refusal. Text posting stays unconditional below. */}
        {media ? (
          <Pressable style={styles.attach} onPress={attachImage} testID="nb-attach"><Text style={styles.attachText}>📎</Text></Pressable>
        ) : null}
        <Pressable style={styles.post} onPress={submitPost} testID="nb-post"><Text style={styles.postText}>{t('circle.noticeboard.post')}</Text></Pressable>
      </View>
      {attachment && (
        <View style={styles.attachPreview} testID="nb-attach-preview">
          <Image source={{ uri: attachment.thumbnail }} style={styles.attachThumb} />
          <Pressable style={styles.attachRemove} onPress={() => setAttachment(null)} testID="nb-attach-remove">
            <Text style={styles.attachRemoveText}>✕</Text>
          </Pressable>
        </View>
      )}
      {intent === 'lend' && (
        <View style={styles.dueRow}>
          <Text style={styles.dueLabel}>{t('circle.noticeboard.due')}</Text>
          <TextInput style={styles.dueInput} value={dueText} onChangeText={setDueText} placeholder="YYYY-MM-DD" placeholderTextColor={theme.color.inkSoft} autoCapitalize="none" testID="nb-due" />
        </View>
      )}
      {busy && <Text style={styles.busy}>{t('circle.noticeboard.posting')}</Text>}
      {error && <Text style={styles.error}>{t('circle.noticeboard.post_failed')}</Text>}

      {posts.length === 0 ? (
        <Text style={styles.empty}>{t('circle.noticeboard.empty')}</Text>
      ) : posts.map((p) => (
        <View key={p.id} style={styles.postRow} testID={`nb-post-${p.id}`}>
          <View style={[styles.badge, styles[`badge_${p.type}`] || styles.badge_ask]}>
            <Text style={styles.badgeText}>{t(`circle.noticeboard.intent.${p.type || 'ask'}`)}</Text>
          </View>
          <Text style={styles.postText2}>{p.text}</Text>
          {embedChipsOf(p).length > 0 && (
            <View style={styles.embeds}>
              <Text style={styles.embedsLabel}>{t('circle.embed.see_also')}</Text>
              {embedChipsOf(p).map((e) => {
                const typeKey = embedTypeLabelKey(e.type);
                const typeLabel = t(typeKey);
                const typeText = (typeLabel && typeLabel !== typeKey) ? typeLabel : e.type;
                const screen = screenForEmbedType(e.type);
                const tappable = !!(screen && !e.locked && typeof onEmbedOpen === 'function');
                const label = `${e.icon} ${typeText}: ${e.label ?? shortRef(e.ref)}`;
                return tappable ? (
                  <Pressable key={e.ref} style={styles.embed} testID={`nb-embed-${e.ref}`}
                    onPress={() => onEmbedOpen({ type: e.type, ref: e.ref, screen })}>
                    <Text style={styles.embedText}>{label}</Text>
                  </Pressable>
                ) : (
                  <View key={e.ref} style={styles.embed} testID={`nb-embed-${e.ref}`}>
                    <Text style={styles.embedText}>{label}</Text>
                  </View>
                );
              })}
            </View>
          )}
          {Array.isArray(p.attachments) && p.attachments.length > 0 && (
            <View style={styles.attachments}>
              {p.attachments.filter((a) => a?.thumbnail).map((att) => (
                <Pressable key={att.id} onPress={() => viewAttachment(p, att)} testID={`nb-att-${att.id}`}>
                  <Image source={{ uri: att.thumbnail }} style={styles.postAtt} />
                </Pressable>
              ))}
            </View>
          )}
          {p.resonance?.reason ? (
            <Text style={styles.resonance}>{`✨ ${t('circle.noticeboard.resonates', { reason: p.resonance.reason })}`}</Text>
          ) : null}
          <View style={styles.actions}>
            {!p.mine && <Chip label={t('circle.noticeboard.action.respond')} onPress={() => runAction('respond', p)} />}
            {p.type === 'lend' && p.mine && <Chip label={t('circle.noticeboard.action.assign')} onPress={() => runAction('assign', p)} />}
            {p.type === 'lend' && p.mine && <Chip label={t('circle.noticeboard.action.returned')} onPress={() => runAction('markReturned', p)} />}
            {p.mine && <Chip label={t('circle.noticeboard.action.cancel')} onPress={() => runAction('cancel', p)} />}
            {!p.mine && <Chip label={t('circle.noticeboard.action.report')} muted onPress={() => runAction('report', p)} />}
            {!p.mine && <Chip label={t('circle.noticeboard.action.mute')} muted onPress={() => runAction('mute', p)} />}
          </View>
          {replyingTo === p.id && (
            <View style={styles.replyRow}>
              <TextInput style={styles.replyInput} value={replyText} onChangeText={setReplyText} placeholder={t('circle.noticeboard.respond_prompt')} placeholderTextColor={theme.color.inkSoft} onSubmitEditing={() => submitReply(p)} testID={`nb-reply-${p.id}`} autoFocus />
              <Pressable style={styles.post} onPress={() => submitReply(p)}><Text style={styles.postText}>{t('circle.contacts.send')}</Text></Pressable>
            </View>
          )}
          {assigningTo === p.id && (
            <View style={styles.replyRow}>
              <TextInput style={styles.replyInput} value={assignText} onChangeText={setAssignText} placeholder={t('circle.noticeboard.assign_prompt')} placeholderTextColor={theme.color.inkSoft} autoCapitalize="none" onSubmitEditing={() => submitAssign(p)} testID={`nb-assign-${p.id}`} autoFocus />
              <Pressable style={styles.post} onPress={() => submitAssign(p)}><Text style={styles.postText}>{t('circle.noticeboard.action.assign')}</Text></Pressable>
            </View>
          )}
        </View>
      ))}

      {/* S5 — full-size image viewer. */}
      <Modal visible={!!viewing} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewing(null)} testID="nb-att-viewer">
          {viewing?.uri ? <Image source={{ uri: viewing.uri }} style={styles.viewerImage} resizeMode="contain" /> : null}
          {viewing?.pending ? <Text style={styles.viewerNote}>{t('circle.noticeboard.attach_fetching')}</Text> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function Chip({ label, onPress, muted }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Pressable style={[styles.chip, muted && styles.chipMuted]} onPress={onPress}>
      <Text style={[styles.chipText, muted && styles.chipTextMuted]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { gap: 12, paddingVertical: 4 },
  intents: { flexDirection: 'row', gap: 6 },
  intent: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.color.line },
  intentActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  intentText: { fontSize: 13, fontWeight: '600', color: theme.color.inkSoft },
  intentTextActive: { color: theme.color.white },
  composerRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, fontSize: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  post: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center' },
  postText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  busy: { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic' },
  error: { fontSize: 13, color: '#b3261e' },
  empty: { fontSize: 14, color: theme.color.inkSoft, paddingVertical: 12 },
  postRow: { padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, backgroundColor: theme.color.white, gap: 4 },
  badge: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  badge_ask: { backgroundColor: '#fdeede' },
  badge_offer: { backgroundColor: '#e6f0e9' },
  badge_lend: { backgroundColor: '#e8eef6' },
  badgeText: { fontSize: 11, fontWeight: '700', color: theme.color.ink, textTransform: 'uppercase' },
  postText2: { fontSize: 14, color: theme.color.ink, lineHeight: 20 },
  // embeds[] — cross-object reference chips.
  embeds: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 2 },
  embedsLabel: { fontSize: 10, color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.4 },
  embed: { borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.card, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 9 },
  embedText: { fontSize: 12, color: theme.color.ink },
  attach: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.line, justifyContent: 'center' },
  attachText: { fontSize: 16 },
  attachPreview: { alignSelf: 'flex-start', marginTop: 4 },
  attachThumb: { width: 96, height: 96, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.line },
  attachRemove: { position: 'absolute', top: -8, right: -8, width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.white, alignItems: 'center', justifyContent: 'center' },
  attachRemoveText: { fontSize: 12, color: theme.color.ink },
  attachments: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 2 },
  postAtt: { width: 120, height: 120, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.line },
  viewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10 },
  viewerImage: { width: '100%', height: '85%' },
  viewerNote: { color: theme.color.white, fontSize: 13, opacity: 0.85 },
  resonance: { fontSize: 12, color: theme.color.accent, marginTop: 4, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.color.accent },
  chipMuted: { borderColor: theme.color.line },
  chipText: { fontSize: 12, fontWeight: '600', color: theme.color.accent },
  chipTextMuted: { color: theme.color.inkSoft },
  replyRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  replyInput: { flex: 1, fontSize: 14, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dueLabel: { fontSize: 13, color: theme.color.inkSoft },
  dueInput: { flex: 1, fontSize: 14, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
});
