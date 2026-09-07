# deploy/web — publish a web app to any web server, from your own machine

Basis, and every web app derived from it, is a Vite app: `npm run build` turns the source into an
`index.html` plus an `assets` folder, and that folder runs on **any web server** that speaks HTTPS —
shared hosting, a VPS, the box. Nothing on the server runs; the browser does the work and talks to the
relay over `wss://`. The one thing a server cannot do is the build, so the build happens here, on the
machine that publishes, and only the result travels. No GitHub in the path.

```
npm run publish:web -- basis --target transip     # build · stamp · upload with a swap · verify
npm run publish:web -- basis --zip                # build · stamp · one archive to upload by hand
npm run publish:web -- basis --dry-run --target transip   # build · stamp · say what would happen
```

What a publish does:

1. **Build** `apps/basis` with the release stamp baked in (`VITE_APP_VERSION` = the nearest git tag, or
   the short sha, `-dirty` when the tree has uncommitted changes) and write `dist/version.json`.
2. **Upload with a swap**: the folder goes up *beside* the live one (`<path>.new`), then is renamed into
   place, so visitors never see a half-uploaded site. Three ways, chosen by the target's `WEB_MODE`:
   `rsync` (a host with SSH), `sftp` (any SFTP-only web host — one batch, no shell needed), `local` (a
   directory on this machine — what the box's web role uses).
3. **Verify**: fetch `WEB_URL/version.json` back and refuse to say "done" unless it reports the tag just
   built. The exit code is the truth.

## Targets

A target is a small env file **outside git**: `deploy/web/targets/<name>.env` (gitignored; copy
`example.env`). It names the host, user, port, path and the public URL. It holds **no password**: the
SSH/SFTP key is your own, in `ssh-agent`. Publishing to a second host is a second file.

## A derived app

`npm run publish:web -- <app> --target <name>` for any `apps/<app>` with a `build` script. Same swap,
same stamp, same verify.

## Tests

`node --test deploy/web/test/` — target parsing, the stamp, a build of a tiny stand-in app with the
stamp baked in, the local swap upload replacing (not merging) the old folder, the sftp batch, and
verify against a server that first serves a stale version. Runs inside `npm run guards`.
