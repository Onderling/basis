# Tunable constants go through the parameter register

> **Status:** convention, 2026-08-09. Project-wide. The "rule" leg of the declaration-layer flywheel
> (helper = carrot, guard = stick, convention = rule).

## The rule
A **tunable constant** is declared through the parameter register, never as a bare literal:

```js
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/params';

// NOT: const ASK_DEFAULT_TTL_MS = 30 * 60_000;
export const ASK_DEFAULT_TTL_MS = param({
  key: 'nearby.ask.defaultTtlMs',
  scope: PARAM_SCOPE.AGENT,       // device | agent | circle — drives SYNC / where a set value routes
  kind:  PARAM_KIND.USER,        // internal | user — the security gate (see below)
  default: 30 * 60_000,
});
```

`param()` RETURNS the default, so wrapping an existing const is **behaviour-identical** — the use site reads
exactly as before. It also FORCES the shape (a param cannot be written without its key/scope/kind), which is
why the helper is the carrot: conforming is the only way to write it.

## Why
One discoverable place for every knob (like the locale files), so:
- an agent/LLM or a settings surface can enumerate and reason about params **without reading the code**;
- the **stale-param guard** (`npm run lint:stale-params`) fails a registered param nobody reads — dead config
  cannot accumulate;
- a settable param routes through the **one** kind-gated `set-param` op (not a bespoke setter per feature);
- the register is the seam the settings form projects over (its `kind:user` slice).

## The two axes
- **`scope` ∈ {device, agent, circle}** — drives SYNC + where a set VALUE persists: `device →`
  `devices/<id>.json`, `agent →` `shared.json` (both per [`cross-app-settings.md`](cross-app-settings.md)),
  `circle →` the circle policy. For a `kind:internal` param scope is a declarative label (it never syncs).
- **`kind` ∈ {internal, user}** — the security gate. `user` params may be set through `set-param`; `internal`
  params are **immutable by construction** — the register keeps no settable value behind them, so a user can
  never poke a threshold/limit to wreck an agent/circle setup. Use `internal` for protocol/buffer/safety bounds
  (timeouts, caps, sizes, rate limits, security windows); `user` only for a genuine user-facing preference.

## What is a tunable (migrate) vs not (leave raw)
- **Migrate:** caps, timeouts, retries, buffer/queue sizes, intervals, debounces, backoffs, rate limits,
  thresholds, byte limits, TTLs, windows, grace periods.
- **Do NOT migrate:** pure unit multipliers (`DAY_MS = 24*60*60*1000`, `MS_PER_MIN`); crypto/wire-format
  invariants tied to a version (`KEY_BYTES`, `NONCE_BYTES`, `ITERATIONS`, `VERSION`); enums, ports, string
  constants. A value that would break the wire/format if it varied is not a tunable — it is a protocol constant.

## Where to import it from
`@onderling/params` is the zero-dependency base leaf. Prefer importing `param` from there. `@onderling/core`
and `@onderling/item-store` **re-export** the surface, so a file that already imports from either can import
`param` from it unchanged. A pure leaf that only needs `param` should depend on `@onderling/params`, not drag in
the heavy kernel.

**Exception — browser-served static modules.** A module shipped directly to the browser (no bundler / import
map) cannot use a bare-specifier `import from '@onderling/params'`; leave its consts raw rather than break the
runtime.

## The three parts that make it hold
- **Helper (carrot):** `param()` forces the shape at the declaration site.
- **Guard (stick):** `lint-stale-params` (in `npm run guards`) — a registered param nobody reads is dead.
- **Convention (rule):** this doc — register a tunable **at every change**. Adoption is gradual, but new
  tunables are registered as they are written; do not add a raw tunable const alongside the register.

## Who may set
`set-param` is an OWNER surface today: it is reached only through the person's own interfaces (the
settings form, the my-data rows, the slash builtins), and a `kind:user` declaration is a promise to
the OWNER, not to every peer or process. No bot, extension, or IoT device may call `set-param`
directly. When such an actor should legitimately tune a value (a thermostat adjusting a polling
cadence, a companion bot adjusting a digest window), the route is a **task-scoped mandate** naming
the specific param key — the same entrust vocabulary every other delegated capability uses — checked
by the decision-class table once that ladder lands. The param's declared `{key, scope, kind}` is the
object such a grant names, which is why consolidating stray device prefs INTO the register precedes
any bot/IoT authority work: a bare storage key cannot be granted, audited, or refused.

## Future
The `param()` spec (`{key, scope, kind, default}`) is a plain object and can grow optional metadata
(`description`, `unit`, `range`/`enum`, `tags`, `effect`) to make the register self-describing for the settings
form and for LLM reasoning — see the roadmap comment in `packages/params/src/params.js`. Add a field only when
a consumer needs it; a `kind:user` param's user-facing copy is localised via `t()`, keyed by the param key —
not a raw string in `param()`.
