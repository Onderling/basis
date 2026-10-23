import { it } from 'vitest';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
it('botprobe', { timeout: 120000 }, async () => {
  const agent = await createRealHouseholdAgent({ seedHousehold: false });
  const b = await agent.callSkill('tasks', 'setBotChatBinding', { chatId: 'chat-1', webid: 'webid:probe' }).catch((e) => ({ thrown: e.message }));
  console.log('BIND', JSON.stringify(b));
  const r = await agent.callSkill('tasks', 'issueBotToken', { chatId: 'chat-1' }).catch((e) => ({ thrown: e.message }));
  console.log('ISSUE', JSON.stringify(r)?.slice(0, 300));
  console.log('AUTH', JSON.stringify(agent.inProcessAuthorization().tasks));
});
