/**
 * Self-tests for lint-hosts-literals — a guard whose own logic is untested is not a guard.
 * `undeclaredHosts` is driven with synthetic sources: red on a hard-coded host the manifest does not declare,
 * green once it is declared; comments, computed hosts, placeholders and vocabulary IRIs pass. The app walk is
 * checked against the real tree so it cannot go blind silently.
 */
import { describe, it, expect } from 'vitest';
import { undeclaredHosts, stringLiterals, isInternetHost, appsWithManifests } from './lint-hosts-literals.mjs';

describe('lint-hosts-literals', () => {
  it('a hard-coded API host the manifest does not declare is red', () => {
    const src = "const BASE = 'https://api.weather.example.net.io/v1';\nfetch(`wss://feed.acme-corp.io/live`);";
    expect(undeclaredHosts(src, [])).toEqual(['api.weather.example.net.io', 'feed.acme-corp.io']);
  });

  it('declared in `hosts`, it is green', () => {
    const src = "fetch('https://api.acme-corp.io/v1/items')";
    expect(undeclaredHosts(src, ['api.acme-corp.io'])).toEqual([]);
  });

  it('a URL in a comment is prose, not a call', () => {
    const src = "// see https://docs.acme-corp.io/guide\n/* licence: https://opensource.acme-corp.io */\nconst x = 1;";
    expect(undeclaredHosts(src, [])).toEqual([]);
  });

  it('a computed host and a host from config pass — the honest miss', () => {
    const src = 'fetch(`https://${host}/v1`); fetch(new URL(path, base)); fetch(process.env.API_URL);';
    expect(undeclaredHosts(src, [])).toEqual([]);
  });

  it('placeholders, IPs, reserved example names and vocabulary IRIs are not internet hosts reached', () => {
    const src = [
      "'https://relay'", "'http://localhost:8787'", "'http://127.0.0.1:3000'", "'https://alice.example'",
      "'https://pod.example.com/x'", "'https://basis.invalid/'", "'http://www.w3.org/ns/ldp#'", "'<https://onderling.org/ns#>'",
    ].join(';');
    expect(undeclaredHosts(src, [])).toEqual([]);
    expect(isInternetHost('login.inrupt.com')).toBe(true);
    expect(isInternetHost('relay')).toBe(false);
  });

  it('the allow-list is by URL prefix: the vocabulary namespace passes, a real call to the same host does not', () => {
    const used = new Set();
    expect(undeclaredHosts("'@prefix o: <https://onderling.org/ns#>.'", [], used)).toEqual([]);
    expect(used.has('https://onderling.org/ns#')).toBe(true);
    expect(undeclaredHosts("fetch('https://onderling.org/api/v1')", [])).toEqual(['onderling.org']);
  });

  it('the scanner keeps string contents and drops comments, including a `//` inside a string', () => {
    expect(stringLiterals("const a = 'https://x.acme.io/a'; // 'https://y.acme.io'")).toEqual(['https://x.acme.io/a']);
  });

  it('the app walk finds the real apps and their manifests (it cannot go blind silently)', async () => {
    const apps = await appsWithManifests();
    const byDir = Object.fromEntries(apps.map((a) => [a.dir, a]));
    for (const d of ['basis', 'household', 'stoop', 'tasks-v0', 'folio']) expect(byDir[d], d).toBeTruthy();
    expect(byDir.stoop.hosts).toContain('nominatim.openstreetmap.org');
    // basis-mobile is a shell of basis: its source counts against basis's hosts.
    expect(byDir.basis.roots.some((r) => r.includes('basis-mobile'))).toBe(true);
  });
});
