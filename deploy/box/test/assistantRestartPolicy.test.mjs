// The assistant's failed start backs off and then EXITS (apps/basis/bin/device-runner.mjs, stopOnUnreadable): the retry
// is the container coming back. Without a restart policy the box stays down after its first back-off, so the role that
// runs it must keep one (deploy/box/README.md, "What restarts it").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPLOY = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

test("the assistant role's container has a restart policy that brings back a start that exited", () => {
  const src = readFileSync(path.join(DEPLOY, 'roles', 'assistant.yml'), 'utf8');
  const block = /\n  assistant:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n|\n[a-z]|$)/.exec(src)?.[1] ?? '';
  assert.ok(block, 'no assistant service in roles/assistant.yml');
  const policy = /\n    restart:\s*"?([a-z-]+)"?/.exec(`\n${block}`)?.[1];
  assert.ok(['unless-stopped', 'always', 'on-failure'].includes(policy), `restart policy: ${policy ?? 'none'}`);
});
