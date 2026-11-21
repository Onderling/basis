/**
 * A Bot API server of our own, for booting the real box against (its `ONDERLING_TELEGRAM_API_ROOT`, as Telegram's
 * self-hosted server would be named): it answers who the bot is, hands out the updates a test queues (a person writing),
 * and keeps every call — what the bot said, the menus it set. `dropMethods` cuts the connection on those calls, so the
 * bot sees a network failure (a fetch error, whose message is the request URL) instead of an answer.
 */
import { createServer } from 'node:http';

export function fakeBotApi({ dropMethods = [] } = {}) {
  const calls = [];
  const queue = [];
  let nextId = 1;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (b) => { body += b; });
    req.on('end', () => {
      const method = req.url.split('/').pop().split('?')[0];
      let args = {}; try { args = body ? JSON.parse(body) : {}; } catch { args = formFields(body); }
      calls.push({ method, args });
      if (dropMethods.includes(method)) { req.socket.destroy(); return; }
      const answer = (result) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result })); };
      if (method === 'getMe') return answer({ id: 1, is_bot: true, first_name: 'Huis', username: 'huisbot' });
      if (method === 'getUpdates') { setTimeout(() => answer(queue.splice(0)), queue.length ? 0 : 300); return; }
      if (method === 'sendMessage') return answer({ message_id: nextId++, date: 0, chat: { id: args.chat_id, type: 'private' }, text: args.text });
      if (method === 'sendPhoto') return answer({ message_id: nextId++, date: 0, chat: { id: args.chat_id, type: 'private' }, caption: args.caption, photo: [{ file_id: `f${nextId}` }] });
      if (method === 'sendMediaGroup') return answer((Array.isArray(args.media) ? args.media : []).map((m) => ({ message_id: nextId++, date: 0, chat: { id: args.chat_id, type: 'private' }, caption: m.caption, photo: [{ file_id: `f${nextId}` }] })));
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
  /** The photos the bot sent this chat (sendPhoto, multipart): caption, buttons, whether bytes came along. */
  const photos = (uid) => calls.filter((c) => c.method === 'sendPhoto' && String(c.args.chat_id) === String(uid)).map((c) => c.args);
  /** The albums the bot sent this chat (sendMediaGroup, multipart): each picture's caption, and the bytes that came along. */
  const albums = (uid) => calls.filter((c) => c.method === 'sendMediaGroup' && String(c.args.chat_id) === String(uid)).map((c) => ({ captions: (c.args.media ?? []).map((m) => m.caption ?? null), files: c.args.files ?? [] }));
  /** What the bot said to this chat (its sendMessage calls, in order). */
  const said = (uid) => calls.filter((c) => c.method === 'sendMessage' && String(c.args.chat_id) === String(uid)).map((c) => c.args);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ calls, write, tap, said, photos, albums, server, root: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}

/** A multipart form's text fields (a photo is sent as one): chat_id, caption, reply_markup (parsed), and whether a file came. */
function formFields(body) {
  const out = {};
  for (const m of String(body).matchAll(/name="([^"]+)"(?:; filename="([^"]*)")?\r\n(?:Content-Type: [^\r]*\r\n)?\r\n([\s\S]*?)\r\n--/g)) {
    const [, name, filename, value] = m;
    if (name === 'photo') { out.photoBytes = value.length; continue; }
    // an album's pictures come as files of their own, named by the `attach://` ids its `media` list gives
    if (filename !== undefined) { (out.files ??= []).push({ name, bytes: value.length }); continue; }
    out[name] = name === 'reply_markup' || name === 'media' ? (() => { try { return JSON.parse(value); } catch { return value; } })() : value;
  }
  return out;
}
