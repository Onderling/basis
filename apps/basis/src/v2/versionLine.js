/**
 * The one version line both shells paint in My data: "Versie v0.1.70-alpha", or the dev word for a build that is not
 * exactly a clean release (web: the tag the release injects at build; the phone: the tag its build was made from —
 * `apps/basis-mobile/appVersion.cjs`). Never a typed value.
 * @param {string|null|undefined} version
 * @param {(key: string, params?: object) => string} t
 */
export function versionLine(version, t) {
  return t('circle.profile.version', { tag: typeof version === 'string' && version ? version : t('circle.profile.version_dev') });
}
