// publish.mjs — the pieces that can be proven without a web host: target parsing, the release stamp,
// a build of a tiny fake app with the stamp baked in, the local swap-upload (also the box's web
// role path), the sftp batch, and verify against a local server that first serves a stale version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTarget, releaseStamp, build, upload, sftpBatch, verify } from '../publish.mjs';

test('parseTarget: defaults, required fields', () => {
  const t = parseTarget('WEB_URL=https://x.org\nWEB_HOST=h\nWEB_USER=u\nWEB_PATH=/www/x\n# WEB_MODE=rsync\n');
  assert.deepEqual([t.WEB_MODE, t.WEB_PORT], ['rsync', '22']);
  assert.equal(parseTarget('WEB_PATH=/srv/out\n').WEB_MODE, 'local');
  assert.throws(() => parseTarget('WEB_HOST=h\n'), /WEB_PATH is required/);
  assert.throws(() => parseTarget('WEB_HOST=h\nWEB_PATH=/x\n'), /WEB_USER is required/);
});

test('releaseStamp: a tag or sha, marked dirty when the tree is', () => {
  const s = releaseStamp();
  assert.match(s.tag, /^[\w.-]+/); assert.match(s.sha, /^[0-9a-f]{7,}$/); assert.ok(s.builtAt);
});

test('build + local swap upload: the stamp is baked in, version.json written, the old folder replaced atomically', () => {
  const root = mkdtempSync(join(tmpdir(), 'publish-'));
  const app = join(root, 'apps/tiny'); mkdirSync(app, { recursive: true });
  // a "vite build" stand-in: writes index.html with the version env baked in
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'tiny', scripts: { build: 'node build.js' } }));
  writeFileSync(join(app, 'build.js'), "const fs=require('fs');fs.mkdirSync('dist/assets',{recursive:true});fs.writeFileSync('dist/index.html',`<p>v ${process.env.VITE_APP_VERSION}</p>`);fs.writeFileSync('dist/assets/a.js','1');");
  const stamp = { tag: 'v9.9.9-test', sha: 'abc1234', builtAt: 'now' };
  const dist = build('tiny', stamp, { appsDir: join(root, 'apps'), log: () => {} });
  assert.match(readFileSync(join(dist, 'index.html'), 'utf8'), /v v9\.9\.9-test/);
  assert.equal(JSON.parse(readFileSync(join(dist, 'version.json'), 'utf8')).tag, 'v9.9.9-test');

  const www = join(root, 'www/site');
  mkdirSync(www, { recursive: true }); writeFileSync(join(www, 'stale.html'), 'old');
  upload(dist, parseTarget(`WEB_PATH=${www}\n`), { log: () => {} });
  assert.ok(existsSync(join(www, 'index.html')) && existsSync(join(www, 'assets/a.js')));
  assert.ok(!existsSync(join(www, 'stale.html')), 'the old folder is gone, not merged');
  assert.ok(!existsSync(`${www}.new`) && !existsSync(`${www}.old`));
});

test('sftpBatch: upload beside, then swap, tolerant of a first publish', () => {
  const b = sftpBatch('/tmp/dist', '/www/site/');
  assert.match(b, /^mkdir \/www\/site\.new$/m);
  assert.match(b, /^put -r \/tmp\/dist\/\* \/www\/site\.new\/$/m);
  assert.match(b, /^-rename \/www\/site \/www\/site\.old$/m);   // "-" = ignore failure (no live folder yet)
  assert.match(b, /^rename \/www\/site\.new \/www\/site$/m);
  assert.match(b, /bye\n$/);
});

test('verify: refuses a stale version, accepts once the new one is served', async () => {
  let tag = 'v1';
  const srv = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ tag, sha: 'x' })); });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    await assert.rejects(verify(url, { tag: 'v2' }, { tries: 2, waitMs: 10 }), /does not report v2 \(serves v1\)/);
    setTimeout(() => { tag = 'v2'; }, 30);
    const seen = await verify(url, { tag: 'v2' }, { tries: 5, waitMs: 20 });
    assert.equal(seen.tag, 'v2');
  } finally { srv.close(); }
});
