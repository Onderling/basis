/**
 * Reports on the governance rail: a report and its resolution are SIGNED statements, so who filed and who closed one
 * are facts the rail proves rather than fields anyone may write.
 *
 * Two rules, one place each:
 *   - ADMISSION (`reportStatementAdmissible`, checked at the rail's ingest — a live fan and a catch-up batch alike): a
 *     filed report's `by` is its author; a resolution's author is an admin of the circle in the folded roster.
 *   - VISIBILITY (`reportReaders`, read by the fan AND the catch-up serve): a report statement is for the circle's
 *     admins and the person who filed it, nobody else — the reported member never learns a report exists.
 *
 * Confidentiality on the wire is the envelope's: every copy is sealed to its one recipient.
 */

/** The two report kinds on the governance lane (distinct from governance's own `resolve`, a proposal's close). */
export const REPORT_FILE_KIND = 'report-file';
export const REPORT_RESOLVE_KIND = 'report-resolve';
export const REPORT_STATEMENT_KINDS = Object.freeze([REPORT_FILE_KIND, REPORT_RESOLVE_KIND]);
export const isReportStatementKind = (kind) => REPORT_STATEMENT_KINDS.includes(kind);

/** The circle's admins by webid, from the folded roster (the projection every binding on this rail reads). */
async function adminRefs(callSkill, circleId) {
  try {
    const r = await callSkill('pinboard', 'listGroupMembers', { groupId: circleId });
    return (Array.isArray(r?.members) ? r.members : []).filter((m) => m && m.role === 'admin').map((m) => m.webid ?? m.addr ?? m.ref).filter(Boolean);
  } catch { return []; }
}

/**
 * Whether a report statement may land (beside its key↔ref binding, which the rail checks first): a filed report names
 * its own author as `by`; a resolution comes from an admin. Any other kind passes through untouched.
 */
export async function reportStatementAdmissible({ kind, ref, circleId, payload }, { callSkill }) {
  if (kind === REPORT_FILE_KIND) return typeof ref === 'string' && !!ref && payload?.by === ref;
  if (kind === REPORT_RESOLVE_KIND) return typeof ref === 'string' && !!ref && (await adminRefs(callSkill, circleId)).includes(ref);
  return true;
}

/**
 * Who may hold a report statement: the circle's admins and the reporter. For a resolution the reporter is read from the
 * filed report it closes (`reporterOf`), so the person who filed learns the outcome and nobody else does.
 */
export async function reportReaders({ circleId, reporter }, { callSkill }) {
  return [...new Set([...(await adminRefs(callSkill, circleId)), ...(typeof reporter === 'string' && reporter ? [reporter] : [])])];
}

/** A report statement as the report model's event (`reportModel.js`): the rail's verified author is `by`. */
export function reportEventOf(statementBody) {
  const b = statementBody ?? {};
  const p = b.payload ?? {};
  if (b.kind === REPORT_FILE_KIND) {
    return { kind: 'report', event: 'report', reportId: b.subject, targetType: p.targetType, targetRef: p.targetRef ?? null,
      targetLabel: p.targetLabel ?? null, reason: typeof p.reason === 'string' ? p.reason : '', by: p.authorRef ?? p.by ?? null, at: p.at ?? 0 };
  }
  if (b.kind === REPORT_RESOLVE_KIND) {
    return { kind: 'report', event: 'resolve', reportId: b.subject, outcome: p.outcome ?? null, by: p.authorRef ?? null, at: p.at ?? 0 };
  }
  return null;
}

/** Which member of the circle an address belongs to (any of their proven per-circle addresses, or their webid). */
async function memberAt(callSkill, circleId, addr) {
  try {
    const r = await callSkill('pinboard', 'listGroupMembers', { groupId: circleId });
    const row = (Array.isArray(r?.members) ? r.members : []).find((m) => m && (m.webid === addr || m.circleAddress === addr
      || (Array.isArray(m.circleAddresses) && m.circleAddresses.some((a) => (typeof a === 'string' ? a : a?.address) === addr))));
    return row ? (row.webid ?? null) : null;
  } catch { return null; }
}

/**
 * THE CATCH-UP SERVE'S NARROWING, by kind: of a circle's governance statements, the report ones go only to their readers
 * (`reportReaders`) — the requester must be an admin, or the person who filed the report (a resolution is theirs through
 * the filing it closes). Every other statement passes. An unknown requester gets no report statement at all.
 *
 * @param {Array<object>} statements  what the serve would send
 * @param {{fromPeerAddr: string, circleId: string}} who
 */
export async function narrowReportStatements(statements, { fromPeerAddr, circleId }, { callSkill }) {
  const list = Array.isArray(statements) ? statements : [];
  if (!list.some((s) => isReportStatementKind(s?.body?.kind))) return list;
  const requester = await memberAt(callSkill, circleId, fromPeerAddr);
  const admins = requester ? await adminRefs(callSkill, circleId) : [];
  const filedBy = new Map(list.filter((s) => s?.body?.kind === REPORT_FILE_KIND).map((s) => [s.body.subject, s.body.payload?.by ?? null]));
  return list.filter((s) => {
    const b = s?.body;
    if (!isReportStatementKind(b?.kind)) return true;
    if (!requester) return false;
    if (admins.includes(requester)) return true;
    const reporter = b.kind === REPORT_FILE_KIND ? (b.payload?.by ?? null) : (filedBy.get(b.subject) ?? null);
    return reporter === requester;
  });
}
