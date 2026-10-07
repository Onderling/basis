/**
 * A Bot API server of our own, for booting the real box against (its `ONDERLING_TELEGRAM_API_ROOT`, as Telegram's
 * self-hosted server would be named): it answers who the bot is, hands out the updates a test queues (a person writing),
 * and keeps every call — what the bot said, the menus it set.
 */
import { createServer } from 'node:http';

export function fakeBotApi() {
  const calls = [];
  const queue = [];
  let nextId = 1;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (b) => { body += b; });
    req.on('end', () => {
      const method = req.url.split('/').pop().split('?')[0];
      let args = {}; try { args = body ? JSON.parse(body) : {}; } catch { /* a form body: not ours */ }
      calls.push({ method, args });
      const answer = (result) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result })); };
      if (method === 'getMe') return answer({ id: 1, is_bot: true, first_name: 'Huis', username: 'huisbot' });
      if (method === 'getUpdates') { setTimeout(() => answer(queue.splice(0)), queue.length ? 0 : 300); return; }
      if (method === 'sendMessage') return answer({ message_id: nextId++, date: 0, chat: { id: args.chat_id, type: 'private' }, text: args.text });
      return answer(true);
    });
  });
  /** A person writes to the bot in their own chat. */
  const write = (uid, text, firstName = 'Ann') => {
    const command = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined;
    queue.push({ update_id: nextId++, message: { message_id: nextId++, date: Math.floor(Date.now() / 1000), text, ...(command ? { entities: command } : {}), chat: { id: Number(uid), type: 'private', first_name: firstName }, from: { id: Number(uid), is_bot: false, first_name: firstName } } });
  };
  /** A person taps a button the bot showed them (Telegram's `callback_query`: the button's id comes back as their line). */
  const tap = (uid, data, firstName = 'Ann') => {
    queue.push({ update_id: nextId++, callback_query: { id: String(nextId++), data, chat_instance: '1', from: { id: Number(uid), is_bot: false, first_name: firstName }, message: { message_id: nextId++, date: Math.floor(Date.now() / 1000), chat: { id: Number(uid), type: 'private', first_name: firstName } } } });
  };
  /** What the bot said to this chat (its sendMessage calls, in order). */
  const said = (uid) => calls.filter((c) => c.method === 'sendMessage' && String(c.args.chat_id) === String(uid)).map((c) => c.args);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ calls, write, tap, said, server, root: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}
