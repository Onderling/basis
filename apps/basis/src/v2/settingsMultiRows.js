/**
 * The row model behind a `kind: 'multi'` settings control — ONE place that turns `ctl.optionsFrom`
 * into `{ kind, labelKey, on, next }` rows, so web and mobile paint the same options and persist the
 * same `next` value for the control's policy field. Adding a multi control is a manifest line plus a
 * branch here; neither shell learns a new list.
 */
import { conversationKindsRows } from './conversationKinds.js';
import { noticeRows } from './noticeSettings.js';

export function multiControlRows(ctl, policy = null) {
  const field = ctl?.policyField;
  switch (ctl?.optionsFrom) {
    case 'conversationKinds':
      return conversationKindsRows({ circleSetting: policy?.[field] ?? null, templateKind: policy?.kind ?? null });
    case 'notices':
      return noticeRows({ circleSetting: policy?.[field] ?? null });
    default:
      return [];
  }
}
