# deploy/box — run any Onderling role on any VPS, self-updating from the release branch

A **box** is one machine that runs one or more *roles* (relay · pod · companion · caddy · backup, and
the feedback repo's collect/aggregate) from the `live` branch of the repos that provide them, and keeps
itself current: a timer checks the release branch every five minutes, rebuilds what changed, waits for
every role's health check, and rolls back when a role does not come up.

`deploy/` already holds the Dockerfiles, compose files and the runbook. The box is their runner.

## Bring a box up

Two DNS A-records by hand (`relay.<your-domain>` → the VPS), then on the VPS as root:

```bash
curl -fsSL https://raw.githubusercontent.com/Onderling/basis/live/deploy/box/install.sh | sudo bash
```

It installs Docker, makes the `onderling` user, opens 80 + 443 only, clones the repos at `live` under
`/opt/onderling/repos/`, asks for the profile, the relay hostname and a Let's Encrypt e-mail, writes
`box.conf` + `.env`, installs the timer, brings the stack up and waits for the health gate. Set
`PROFILE`, `RELAY_DOMAIN`, `ACME_EMAIL` in the environment to skip the questions; `BOX_REPO_URL` for a
private clone URL (a read-only deploy key, see the runbook).

Profiles today: **`relay`** (relay + caddy — the first box, go-live's public relay). The others
(`platform`, `feedback-project`, `personal`) are named in the plan and refused by `install.sh` until built.

## The box directory (`/opt/onderling`)

| file | what |
|---|---|
| `box.conf` | the profile: `REPOS="name=url#branch …"` and `ROLES="role@repo …"` |
| `.env` | secrets + hostnames for compose (`RELAY_DOMAIN`, `ACME_EMAIL`, optional `R2_*`/push, the alert chat). **`update.sh` never writes it.** |
| `state.json` | what is RUNNING: per repo the sha + tag + when, `rolledBack`, `failedRole` — the answer to "what are testers on?" |
| `HOLD` | present ⇒ the updater does nothing. `touch HOLD` before a walk, `rm HOLD` after. |
| `box.log` | one line per event (fetches, updates, health, rollbacks) |
| `repos/<name>/` | one git checkout per repo, detached at the release sha |
| `data/` | the generated Caddyfile; compose volumes hold the rest |

## The updater (`update.sh`, every 5 min via `onderling-box.timer`)

1. `HOLD` present → exit.
2. Per repo: fetch the release branch. Same sha as `state.json` → nothing to do.
3. New sha → check it out (detached), `compose build` the roles of that repo, `compose up -d`.
4. Wait for every enabled role's health script (`HEALTH_TIMEOUT`, 60 s).
5. Green → write `state.json`. Red → check the previous sha back out, restart, write `state.json` with
   `rolledBack: true` + the failing role, log it, and send one Telegram line when `BOX_ALERT_TG_TOKEN` +
   `BOX_ALERT_TG_CHAT` are set in `.env`.

A release whose tag message contains `RESET` (a data reset by the no-backwards-compat rule) is refused
until the box is run with `ALLOW_RESET=1`. `FORCE=1 update.sh` rebuilds without a new sha (the first
bring-up uses it). Run by hand: `sudo -u onderling BOX_DIR=/opt/onderling bash /opt/onderling/repos/canopy-mono/deploy/box/update.sh`.

## The role contract (how a repo plugs in)

A repo provides, under its own `deploy/roles/`:

| file | purpose |
|---|---|
| `<role>.yml` | a docker compose fragment; build contexts relative to the file |
| `<role>.health` | optional executable: exit 0 = healthy. Gets `COMPOSE` (the full compose command), `BOX_DIR`, `ROLE` |
| `<role>.caddy` | optional Caddy site snippet; `${VAR}` is substituted from `.env` |

The box merges the fragments of the enabled roles into one compose project (`onderling`) and renders
the Caddyfile from the snippets. This repo's roles live in `deploy/roles/` (`relay`, `caddy`); the
feedback repo will provide `feedback-collect` and `feedback-aggregate` the same way, and so can a
partner's repo. The box knows a repo only by `name=url#branch` in `box.conf`.

`BOX_SMOKE=1` in the environment of `update.sh` makes the relay's health check also run the wire-protocol
smoke (`deploy/smoke`) over the public `wss://` — slower, and the real proof after a first bring-up.

## Tests

`node --test deploy/box/test/` proves the updater against a real git remote and a fake `docker`: no
change → no call; a new commit → checkout, build, up, recorded with its tag; a red health gate → rollback
to the previous sha, recorded and logged; `HOLD`; `RESET` refused; the Caddyfile rendered; `install.sh`
end to end with the system steps skipped. It runs inside `npm run guards`.
