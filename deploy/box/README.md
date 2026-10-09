# deploy/box — run any Onderling role on any VPS, self-updating from the release branch

A **box** is one machine that runs one or more *roles* (relay · pod · companion · caddy · backup, and
the feedback repo's collect/aggregate) from the `live` branch of the repos that provide them, and keeps
itself current: a timer checks the release branch every minute, rebuilds what changed, waits for
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

Profiles today: **`relay`** (relay + caddy — the first box, go-live's public relay), **`platform`**
(relay + pod + companion + caddy; asks for the pod hostname too) and **`feedback-project`** (relay + pod +
caddy + the feedback repo's `feedback-collect` and `feedback-aggregate`; asks the activation and portal
hostnames and the Privatemode key; clones the feedback repo at `live` beside this one) and **`personal`**
(companion + the basis assistant on Telegram, dialing the SHARED relay — no hostname, no Caddy, no
certificate; asks the relay URL, the bot token, your chat id and the Privatemode key). `platform` and
`feedback-project` also run the `backup` role.

## One machine or two — which roles may share a box

Roles share a box freely: `ROLES` in `box.conf` is a list, and the `platform` profile is exactly relay +
pod + companion + caddy + backup on one machine. Adding a role to a running box is an edit, not an install:
add `role@repo` to `ROLES`, put its `.env` keys in place, run the updater as the box's user, the way its timer
does — `sudo -u onderling env BOX_DIR=/opt/onderling FORCE=1 bash /opt/onderling/repos/basis/deploy/box/update.sh`
(as root, git refuses the repo it does not own and the update keeps the old release) — the role is built, the
stack comes up, the health gate runs, `state.json` records it. **Two boxes on one machine is not a thing**:
a box is one directory, one compose project (`onderling`) and one timer, and a second one would collide on
all three.

Which roles SHOULD share a machine is a different question, and one pairing is wrong outside a test:
**your own always-on device (`assistant`, the `personal` profile) does not belong on the machine that runs
the public relay.** The relay box has 80 and 443 open to the world by design; the device holds the person's
profile keys, their contacts' keys and the content of every circle they are in, and needs no open port at
all — it only dials out. Putting the thing that holds the keys on the one machine that is exposed is the
pairing to avoid; a second small VPS is the cheap fix. (A co-located device also rebuilds the whole app image
on the relay's machine at every release that touches `apps/basis/`, which a relay-only box never does.)
Reaching the relay from a role on the same box works by its public name (`wss://<relay-domain>`, measured
2026-09-18 from inside a container: 8/8 smoke); the internal name `ws://relay:8787` also connects but is
the URL the device would then ADVERTISE on its contact card, which nobody outside can dial — use the public name.

## A household's agenda links (the companion serves them, through the relay)

A household bot can give each person their agenda as a link for a calendar app (`/agenda-link`, behind the admin's
`/huishouden agenda on`). The files are kept by the household's **companion**, sealed to a key only each link carries
(it holds ciphertext only); the bot puts each person's file there. The companion needs no public port: the link is
`https://<relay-domain>/feed/<companion address>/<id>.<k>.ics`, and the **relay** forwards it to the companion over the
companion's own connection and passes the answer on, holding nothing (`relay.caddy` sends that form to the relay, with
no access log). The companion will run on the household's tablet beside the bot; until it moves, the `companion` role
on the public box is a test instance, and its own older `/feed/<id>.<k>.ics` route still answers through Caddy.

The bot learns where from the companion's **contact card** (its address, and `serves`: where its links are served),
never from configuration: the person linked as the bot's admin hands it over from their app. Nothing is set on the box
beyond starting the roles (`companion@<repo>` and the assistant in `ROLES`; the role runs the companion with its agenda
files on and says its public address from `$RELAY_DOMAIN`). Step 0, from the admin's app:

1. **Link your app to the bot.** In your private chat with the bot: `/koppel`. Open the link it sends, tap "Maak de
   koppelregel", paste the line into the chat and pick the code your app shows. The bot is now a contact in your app,
   and your app's messages to it count as you — from every device of yours, not from one you revoke.
2. **Claim the companion.** Its claim line (ten minutes, then a new one) is in
   `docker compose -p onderling logs companion | grep 'Claim:' | tail -1`; paste it under My data → "Companion claimen".
3. **Give the bot the agenda files.** Under My data → "Mijn agents", at the companion: "Toegang geven", pick the bot,
   tick "agenda-bestanden plaatsen". In that one act your app hands the bot the companion's card and the companion gives
   the bot its access. Only the bot's admin can do this; a member's app is refused.
4. **Check:** `curl -s -o /dev/null -w '%{http_code}\n' https://<relay-domain>/feed/<companion address>/xxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyy.ics`
   answers `404` after a second (the route is there; nothing is served without a link, and a miss takes as long whether
   the companion is connected or not). Then in Telegram: `/huishouden agenda on`, `/agenda-link`.

Whoever holds a person's link reads that person's agenda, and the calendar service it is pasted into keeps it
readable — the bot says so when it sends the link. `/agenda-link` again makes a new link (the old one stops),
`/revoke` and `/huishouden agenda off` drop the files.

## The box directory (`/opt/onderling`)

| file | what |
|---|---|
| `box.conf` | the profile: `REPOS="name=url#branch …"` and `ROLES="role@repo …"` |
| `.env` | secrets + hostnames for compose (`RELAY_DOMAIN`, `POD_DOMAIN`, `ACTIVATE_HOST`, `PORTAL_HOST`, `ACME_EMAIL`, `PRIVATEMODE_API_KEY`, optional `R2_*`/push, the alert chat). **`update.sh` never writes it.** |
| `state.json` | what is RUNNING: per repo the sha + tag + when, `rolledBack`, `failedRole`, `lastGood` (the last version that passed the health gate) and `previousGood` (the one before it) — the answer to "what are testers on?" |
| `HOLD` | present ⇒ the updater does nothing. `touch HOLD` before a walk, `rm HOLD` after. |
| `box.log` | one line per event (fetches, updates, health, rollbacks) |
| `repos/<name>/` | one git checkout per repo, detached at the release sha |
| `data/` | the generated Caddyfile and the status page (`data/www/`); compose volumes hold the rest |

## The HTML face (kept simple)

`https://<relay-domain>/box/` is a **read-only status page**: profile and roles, whether `HOLD` is set,
the last update and whether it rolled back, `state.json`, and the last 50 log lines. It is static HTML
the updater rewrites on every state change (`data/www/`), served by Caddy — no server code, no login,
nothing secret on it. Anything interactive (freeze, force an update) stays a command on the box.

## The updater (`update.sh`, every minute via `onderling-box.timer`)

1. `HOLD` present → exit.
2. Per repo: ask the remote for the release branch's sha (`git ls-remote`, one request). Same sha as
   `state.json` → nothing to do, nothing fetched. A sha this box rolled back or refused (`RESET`) is left
   alone for `RETRY_AFTER` seconds (300) after that, so a bad release is not rebuilt (or alerted) every
   minute. Otherwise: fetch it with its tags.
   *A box installed before 2026-10-05 keeps its five-minute timer until the unit is copied again:*
   `sudo cp <repo>/deploy/box/systemd/onderling-box.timer /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart onderling-box.timer`.
3. **A fresh export comes first.** Before the first checkout, when the assistant role is running, the updater asks it
   for an export of the household (`compose exec -T assistant node apps/basis/bin/export-now.mjs --sha <outgoing>`:
   the running assistant writes `exports/pre-update-<when>-<sha>.json` on its shelf, the last three kept beside the
   nightly ones). If that fails, the update is **held**: nothing is checked out, the log and the alert say so. An
   assistant that is not running cannot be asked: the update goes ahead only when its shelf already holds an export
   younger than a day (read from its volume without starting it); otherwise it is held too.
4. New sha → check it out (detached), `compose build` the roles of that repo **whose `<role>.paths` the
   release actually touched**, then `compose up -d`. This is what keeps a docs-only release from
   recreating the public relay container — which drops its in-memory hold-and-forward queue and
   disconnects every client (measured on the first box: the relay had been restarted by a release that
   changed only the web app).
5. If the rendered Caddyfile changed, reload Caddy in place — its config is a bind mount, so
   `compose up -d` never notices a change to it (a role added, a hostname edited) and the old config
   would keep serving.
6. Wait for every enabled role's health script (`HEALTH_TIMEOUT`, 60 s).
7. Green → the running version becomes `lastGood` (the one it replaces `previousGood`), write `state.json`. Red →
   check `lastGood` back out (the previous sha when there is none yet), restart, write `state.json` with
   `rolledBack: true` + the failing role, log it, and send one Telegram line when `BOX_ALERT_TG_TOKEN` +
   `BOX_ALERT_TG_CHAT` are set in `.env`.

A release whose tag message contains `RESET` (a data reset by the no-backwards-compat rule) is refused
until the box is run with `ALLOW_RESET=1`. **`ROLLBACK=1 update.sh`** is the way back by hand, for a release whose
health gate was green but which the household says is wrong: it returns to `previousGood` (the version before the
newest green one), which becomes `lastGood` again; the abandoned release is not taken again, a newer one is. `FORCE=1 update.sh` rebuilds without a new sha (the first
bring-up uses it). Run by hand: `sudo -u onderling BOX_DIR=/opt/onderling bash /opt/onderling/repos/basis/deploy/box/update.sh`.

## The role contract (how a repo plugs in)

A repo provides, under its own `deploy/roles/`:

| file | purpose |
|---|---|
| `<role>.yml` | a docker compose fragment; build contexts relative to the file |
| `<role>.health` | optional executable: exit 0 = healthy. Gets `COMPOSE` (the full compose command), `BOX_DIR`, `ROLE` |
| `<role>.caddy` | optional Caddy site snippet; `${VAR}` is substituted from `.env` |
| `<role>.paths` | optional: the repo paths this role's image is built from, one prefix per line. The updater rebuilds the role only when a release touched one of them. **No file = always rebuild** (the safe default). In this repo they are GENERATED from the real workspace dependency closure — `npm run box-role-paths`, checked by `npm run guards` |

The box merges the fragments of the enabled roles into one compose project (`onderling`) and renders
the Caddyfile from the snippets. This repo's roles live in `deploy/roles/` (`relay`, `caddy`, `pod`, `companion`, `assistant`, `backup`); the
feedback repo provides `feedback-collect` and `feedback-aggregate` the same way (its `deploy/roles/`),
and so can a partner's repo. The box knows a repo only by `name=url#branch` in `box.conf`.

A health script is told whether THIS update rebuilt its role (`ROLE_REBUILT=0|1`), so an expensive check
can prove a NEW build instead of re-proving a process that never stopped. Every role is still checked.

The relay's health check runs the **wire-protocol smoke** (`deploy/smoke`: register, two-party delivery,
offline hold and flush, fan-out) against the relay's own socket on every update — so a release that
breaks message delivery is rolled back rather than served. It uses the INTERNAL socket deliberately:
measured on the first box, the public `wss://` hangs from inside the container while `https://` to the
same name answers, so gating on it there would fail good releases. It runs when the relay was rebuilt;
`BOX_SMOKE=1` forces it on any update and `BOX_SMOKE=0` turns it off. The public name, its certificate and
the upgrade through Caddy are proven from OUTSIDE after a bring-up:
`node deploy/smoke/smoke.mjs wss://<relay-domain>`.

## Backups (role `backup`)

A restic sidecar snapshots every box volume (relay, pod, companion, assistant, feedback, caddy) plus
`state.json` to **every** target in `data/backup-targets/*.env` (one file per target — two providers
= redundancy; see `deploy/backup/targets.env.example`), daily by default (`BACKUP_INTERVAL`), then
prunes and verifies. No target files ⇒ the run says so and backs up nothing. Restore:
`docker compose --project-name onderling exec backup sh /backup/backup.sh restore <target> latest /tmp/r`.

## Tests

`node --test deploy/box/test/` proves the updater against a real git remote and a fake `docker`: no
change → no call; a new commit → checkout, build, up, recorded with its tag; a red health gate → rollback
to the previous sha, recorded and logged; `HOLD`; `RESET` refused; the Caddyfile rendered; `install.sh`
end to end with the system steps skipped, for the `relay`, `platform` and `feedback-project` profiles (the
last with a stand-in second repo honouring the contract). It runs inside `npm run guards`.
