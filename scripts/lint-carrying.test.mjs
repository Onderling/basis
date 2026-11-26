import { describe, it, expect } from 'vitest';
import { checkCarrying, findCarriers, parseIndex, keysOf, carryingMessages } from './carrying.mjs';

const INDEX = `# x
## Between people
| I want to… | Mechanism | Lives in | Who learns what | Used today by | Not for |
|---|---|---|---|---|---|
| serve a file at a link | link seal | \`linkSeal.js\` (\`sealForLink\`) | the host | \`apps/a/src/consumer.js\` | — |
## Inert — built, reached by nothing
| What it would do | Mechanism | Lives in | Only reached by |
|---|---|---|---|
| stream an answer | streaming | \`streaming.js\` | tests |
`;
const SERVER = [{ file: 'apps/c/src/server.js', kind: 'route', find: /['`](\/[a-z][a-z0-9_.-]*)/g }];
const run = (tree, carriers) => checkCarrying({
  read: (rel) => { if (!(rel in tree)) throw new Error(`no ${rel}`); return tree[rel]; },
  files: Object.keys(tree).filter((f) => f.endsWith('.js')),
  carriers, serverFiles: SERVER, indexPath: 'index.md',
});
const tree = (over = {}) => ({
  'index.md': INDEX,
  'apps/c/src/server.js': "if (p.startsWith('/feed/')) {}",
  'apps/a/src/consumer.js': "import { sealForLink } from '@onderling/blob-gateway';",
  ...over,
});
const carriers = [{ id: '/feed', row: 'serve a file at a link' }];

describe('lint-carrying — the carrying index held to the code', () => {
  it('green: every route declared with its row, every consumer reaches its row; inert rows counted', () => {
    const r = run(tree(), carriers);
    expect(r).toMatchObject({ unlisted: [], unknownRow: [], unreached: [], inert: 1, rows: 2 });
  });

  it('a route added to a server without a row is red — the builder must open the table', () => {
    const r = run(tree({ 'apps/c/src/server.js': "if (p.startsWith('/feed/')) {} if (p === '/files') {}" }), carriers);
    expect(r.unlisted).toEqual([{ id: '/files', kind: 'route', file: 'apps/c/src/server.js' }]);
  });

  it('a declared carrier naming a row the table does not have is red', () => {
    expect(run(tree(), [{ id: '/feed', row: 'a row that is gone' }]).unknownRow).toEqual([{ id: '/feed', row: 'a row that is gone' }]);
  });

  it('a row whose consumer file does not use the mechanism is red; so is a consumer that does not exist', () => {
    expect(run(tree({ 'apps/a/src/consumer.js': '// mentions nothing' }), carriers).unreached.map((u) => u.consumer)).toEqual(['apps/a/src/consumer.js']);
    const gone = tree(); delete gone['apps/a/src/consumer.js'];
    expect(run(gone, carriers).unreached[0]).toMatchObject({ why: 'no such file' });
  });

  it('the parts: a route is its first segment; keys drop paths and extensions', () => {
    expect(findCarriers("'/manage/pair/start' '/manage'", /['`](\/[a-z][a-z0-9_.-]*)/g)).toEqual(['/manage']);
    expect(keysOf('`@onderling/blob-gateway` `linkSeal.js` (`sealForLink`)')).toEqual(['blob-gateway', 'linkSeal', 'sealForLink']);
    expect(parseIndex(INDEX).map((r) => [r.first, r.inert])).toEqual([['serve a file at a link', false], ['stream an answer', true]]);
  });
});

describe('lint-carrying — each red line says where and what to do instead', () => {
  it('names the route, the carrier and the row as file:line, each with a Fix', () => {
    const t = tree({ 'apps/c/src/server.js': "if (p.startsWith('/feed/')) {}\nif (p === '/files') {}", 'apps/a/src/consumer.js': 'nothing here' });
    const r = run(t, [{ id: '/feed', row: 'a row that is gone' }]);
    const read = (rel) => t[rel] ?? "CARRIERS = [\n  { id: '/feed', row: 'a row that is gone' },\n]";
    const msg = carryingMessages(r, { read, indexPath: 'index.md', carriersPath: 'scripts/carrying.mjs' }).join('\n');
    expect(msg).toMatch(/apps\/c\/src\/server\.js:2: route \/files/);
    expect(msg).toMatch(/scripts\/carrying\.mjs:2: \/feed/);
    expect(msg).toMatch(/index\.md:\d+: "serve a file at a link"/);
    expect(msg.match(/Fix: /g).length).toBe(3);
  });
});
