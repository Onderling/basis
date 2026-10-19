/**
 * sharedAppointment — an own appointment shared with a contact, as an ITEM in their pair circle (never a file, never a
 * reference the contact cannot open). What crosses is MINIMAL: the title, when it starts and ends, whether it is
 * cancelled — no attendees, no circle, nothing that says where it came from. The person keeps the link on THEIR side
 * only (a `shared` mark on their own item, carried to their own devices), so an edit or a cancel there re-shares it.
 */
import { hashHex } from '@onderling/core';

/**
 * The copy's id in a pair circle: derived from (the source, the pair circle) so a re-share UPSERTS the one copy — and
 * says nothing of the source's own id to the contact.
 */
export function sharedCopyIdFor(sourceId, pairCircleId) {
  return `shared-${hashHex(`${pairCircleId}|${sourceId}`).slice(0, 24)}`;
}

/** What the contact receives of an appointment: its words and its moments, nothing else. */
export function sharedFieldsOf(event) {
  return {
    title: String(event?.title ?? '').trim(),
    startsAt: event?.startsAt ?? null,
    ...(event?.endsAt ? { endsAt: event.endsAt } : {}),
    ...(event?.state === 'cancelled' ? { state: 'cancelled' } : {}),
  };
}

/** The source's own mark, with this pair circle's copy in it (once). */
export function withSharedMark(event, pairCircleId, copyId) {
  const marks = (Array.isArray(event?.shared) ? event.shared : []).filter((m) => m?.pairCircleId !== pairCircleId);
  return { ...event, shared: [...marks, { pairCircleId, copyId }] };
}
