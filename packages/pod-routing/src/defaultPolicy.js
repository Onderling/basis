/**
 * Default storage-function → URI mapping policy.
 *
 * Built dynamically from the user's `anchorPodUri` (the pod that
 * holds their main storage; `null` for no-pod users) and
 * `deviceId`. Each storage function gets a sensible default URI;
 * user overrides ride on top of these via the mappings config.
 *
 * See functional design §4.3.4.
 */
export function buildDefaultPolicy({ anchorPodUri, deviceId }) {
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw Object.assign(
      new Error('buildDefaultPolicy: deviceId is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const hasPod = typeof anchorPodUri === 'string' && anchorPodUri.length > 0;
  const podBase = hasPod ? _stripTrailingSlash(anchorPodUri) : null;
  const localBase = `pseudo-pod://${deviceId}`;

  const privateBase = hasPod ? `${podBase}/private/` : `${localBase}/private/`;
  const sharingBase = hasPod ? `${podBase}/sharing/` : `${localBase}/sharing/`;
  const profileCard = hasPod
    ? `${podBase}/sharing/public/profile-card`
    : `${localBase}/sharing/public/profile-card`;
  const groupLocal = `${localBase}/group/`;
  const personalInGroup = hasPod
    ? `${podBase}/personal-in-group/`
    : `${localBase}/personal-in-group/`;

  return {
    mappings: {
      'private/*':              privateBase,
      'sharing/*':              sharingBase,
      'sharing/profile-public': profileCard,
      'group/*':                groupLocal,         // overridden per-circle when policy is centralised
      'personal-in-group/*':    personalInGroup,
    },
    // For unknown circles, default to no-pod replication-ring storage
    // when there's no anchor pod, or centralised on the anchor pod
    // when there is one.
    circlePolicyDefault: hasPod
      ? { policy: 'shared', groupPodUri: anchorPodUri }
      : { policy: 'none' },
  };
}

function _stripTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
