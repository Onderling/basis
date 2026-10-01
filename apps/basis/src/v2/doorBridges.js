/**
 * doorBridges — several doors, one runner: the assistant answers Telegram and the bot's inbox with ONE engine.
 *
 * Each door is a MessagingBridge. The multiplexer is one too: an incoming message carries its door (`channel`) and a
 * chat id prefixed with the door's id, so replies find their way back and two doors' chats never share a lane; the
 * runner, the engine, the gate and the threads are the same for both.
 */
const SEP = '::';

/** @param {Array<object|null>} bridges */
export function multiplexBridges(bridges) {
  const doors = bridges.filter(Boolean);
  return {
    id: 'doors',
    async start() { await Promise.all(doors.map((b) => b.start())); },
    async stop() { await Promise.all(doors.map((b) => b.stop())); },
    onMessage(h) {
      for (const b of doors) {
        b.onMessage((msg) => h({ ...msg, channel: msg.channel ?? b.channel ?? b.id, chatId: `${b.id}${SEP}${msg.chatId}` }));
      }
    },
    sendReply({ chatId, ...rest }) {
      const s = String(chatId ?? '');
      const i = s.indexOf(SEP);
      const door = i > 0 ? doors.find((b) => b.id === s.slice(0, i)) : null;
      if (!door) return Promise.resolve();
      return door.sendReply({ ...rest, chatId: s.slice(i + SEP.length) });
    },
  };
}
