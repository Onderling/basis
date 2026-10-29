/**
 * The shape a landed noticeboard post is announced in (the notification and the driver match read it): derived from
 * the stored item, whatever kind of post it is.
 */

/**
 * The announcement's payload, built from the stored item. `requestId` is the item's own id, the same id the
 * reply of `postRequest` hands its author, so one post has one id everywhere.
 */
export function noticeboardFanPayload(item, { from, groupId = null } = {}) {
  const src = item.source ?? {};
  const targets = Array.isArray(src.targets) && src.targets.length
    ? src.targets
    : (groupId ? [{ kind: 'group', groupId }] : []);
  return {
    requestId:      item.id,
    text:           item.text ?? item.body ?? '',   // a circle-store row carries `body` (canonical), pinboard's index `text`
    from,
    type:           item.type ?? 'request',
    kind:           item.kind ?? null,
    dueAt:          typeof item.dueAt === 'number' ? item.dueAt : null,
    categoryId:     item.categoryId ?? src.categoryId ?? null,
    skillTags:      Array.isArray(item.skillTags) ? item.skillTags : (Array.isArray(src.skillTags) ? src.skillTags : []),
    requiredSkills: Array.isArray(item.requiredSkills) ? item.requiredSkills : [],
    targets,
    attachments:    Array.isArray(src.attachments) ? src.attachments : (Array.isArray(item.attachments) ? item.attachments : []),
    ...(Array.isArray(src.embeds) && src.embeds.length > 0 ? { embeds: src.embeds } : {}),
  };
}
