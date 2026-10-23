/**
 * What a browser calls itself, for the "this device" row when the person never named it: the browser and the system
 * it runs on, read from the user agent ("Firefox · Linux"). Null when neither is recognised — the row then says only
 * "this device". The phone has its own name (the OS's device name); this is the web shell's.
 */
const BROWSERS = [[/Edg\//, 'Edge'], [/OPR\//, 'Opera'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Safari\//, 'Safari']];
const SYSTEMS = [[/Android/, 'Android'], [/iPhone|iPad/, 'iOS'], [/Windows/, 'Windows'], [/Mac OS X|Macintosh/, 'macOS'], [/CrOS/, 'ChromeOS'], [/Linux/, 'Linux']];

export function browserDeviceName(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null;
  return [browser, system].filter(Boolean).join(' · ') || null;
}
