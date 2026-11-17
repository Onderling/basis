/* A stand-in model for the phone walks: an OpenAI-compatible `/v1/chat/completions` on this laptop that answers from a
 * SCRIPT, the phone's twin of the browser specs' test model (apps/basis/src/v2/testModel.js). The phone reaches it as
 * the person's own LOCAL model (`adb reverse`), set through the real settings screen, so everything but the model is
 * the shipped app: the door, the prompt it builds, the tools it hands over, how the answer is read. No key, no credits,
 * the same answer every run. Every request is kept (`requests`) so a walk asserts what the phone SENT.
 *
 * A script entry: `when` (a string the newest user message contains), then `replyText` or `toolCall: {id, args}`.
 * No entry matches: an empty reply (the door says it could not read the line), and the request is still kept.
 */
const http = require('node:http');
const { execFileSync } = require('node:child_process');

/** The newest user message's own words (the door appends its turn notes below a marker; those are not the line). */
function newestLine(messages) {
  const user = [...(messages ?? [])].reverse().find((m) => m?.role === 'user');
  return String(user?.content ?? '').split('\n--- This turn ---')[0].trim();
}

/**
 * @param {Array<{when: string, replyText?: string, toolCall?: {id: string, args?: object}}>} script
 * @param {{port?: number}} [o]
 * @returns {Promise<{port: number, requests: Array<{system: string|null, messages: Array, tools: string[]}>, close: () => Promise<void>}>}
 */
async function startStandInModel(script, { port = 8090 } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return; }
      let q = {};
      try { q = JSON.parse(body || '{}'); } catch { /* an unreadable request is kept empty */ }
      const messages = Array.isArray(q.messages) ? q.messages : [];
      const system = messages.find((m) => m?.role === 'system')?.content ?? null;
      requests.push({ system, messages: messages.filter((m) => m?.role !== 'system'), tools: (q.tools ?? []).map((t) => t?.function?.name ?? null) });
      const line = newestLine(messages);
      const hit = script.find((e) => line.includes(e.when)) ?? null;
      const message = hit?.toolCall
        ? { role: 'assistant', content: null, tool_calls: [{ id: `call-${requests.length}`, type: 'function', function: { name: hit.toolCall.id, arguments: JSON.stringify(hit.toolCall.args ?? {}) } }] }
        : { role: 'assistant', content: hit?.replyText ?? '' };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `standin-${requests.length}`, object: 'chat.completion', model: 'stand-in', choices: [{ index: 0, message, finish_reason: hit?.toolCall ? 'tool_calls' : 'stop' }] }));
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { port, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** The phone's own 127.0.0.1:<phonePort> reaches this laptop's <port> (USB). */
function reversePort(phonePort, port, serial = process.env.ANDROID_SERIAL) {
  execFileSync('adb', [...(serial ? ['-s', serial] : []), 'reverse', `tcp:${phonePort}`, `tcp:${port}`]);
}

module.exports = { startStandInModel, reversePort, newestLine };
