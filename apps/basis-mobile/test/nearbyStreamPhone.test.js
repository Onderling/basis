/**
 * The phone's Conversation tab paints the same stream as web: chat lines, and a card for each question asked here and
 * each circle offered here, in the order `nearbyStream` gives (shared code, never the painter); each tab's label says
 * what is new by `nearbyTabNews`. Screens have no render harness here, so this reads the component's source: the order
 * and the counts must come from the shared functions, and the cards must reuse the Questions tab's actions.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../src/screens/v2/CircleLauncherScreen.js', import.meta.url)), 'utf8');

function nearbyScreenBody() {
  const start = SRC.indexOf('function NearbyScreen({');
  expect(start, 'NearbyScreen is defined').toBeGreaterThan(-1);
  return SRC.slice(start, SRC.indexOf('\n}\n', start));
}

describe('the phone\'s Conversation stream and tab counts', () => {
  it('the stream comes from the shared nearbyStream, and the chat section paints it (not model.chat directly)', () => {
    const body = nearbyScreenBody();
    expect(body).toMatch(/nearbyStream\(model\)/);
    const chatPart = body.slice(body.indexOf("'nearby-chat': () => ("), body.indexOf("'nearby-chat-off': () => ("));
    expect(chatPart).toMatch(/stream\.map\(/);
    expect(chatPart).not.toMatch(/\bchat\.map\(/);
    expect(chatPart).toMatch(/askCard\(item\.entry, true\)/);
    expect(chatPart).toMatch(/inviteCard\(item\.entry, true\)/);
  });

  it('a card in the stream is headed with who, and its buttons are the same handlers as in Questions', () => {
    const body = nearbyScreenBody();
    expect(body).toMatch(/circle\.nearbyScreen\.stream_ask_from/);
    expect(body).toMatch(/circle\.nearbyScreen\.stream_invite_from/);
    // the Questions tab paints its entries through the same two card painters
    expect(body).toMatch(/asks\.map\(\(entry\) => askCard\(entry\)\)/);
    expect(body).toMatch(/invites\.map\(\(entry\) => inviteCard\(entry\)\)/);
    expect((body.match(/onAskAction\(action, entry\.ask\)/g) ?? []).length, 'one Answer/Dismiss handler for both places').toBe(1);
    expect((body.match(/onInviteAction\?\.\(action, entry\.invite\)/g) ?? []).length, 'one Join handler for both places').toBe(1);
  });

  it('hidden from the room: the chat-off part says so and its button is the existing act (setQuiet / setRadio)', () => {
    const body = nearbyScreenBody();
    expect(body).toMatch(/const \{ tabs, defaultTab, chatOff(, askOff)? \} = nearbyTabs\(model\)/);
    const offPart = body.slice(body.indexOf("'nearby-chat-off': () =>"));
    expect(offPart).toMatch(/circle\.nearbyScreen\.chat_hidden_line/);
    expect(offPart).toMatch(/circle\.nearbyScreen\.chat_hidden_action/);
    expect(offPart).toMatch(/unquiet: \(\) => onSetQuiet\?\.\(false\)/);
    expect(offPart).toMatch(/'radio-on': \(\) => onSetRadio\?\.\('on'\)/);
  });

  it('the "you here" row is the shared nearbyMineSummary (never "in the conversation" while hidden), not its own chips', () => {
    const body = nearbyScreenBody();
    expect(body).toMatch(/nearbyMineSummary\(model\)/);
    expect(body).not.toMatch(/allows\.chat \? t\('circle\.nearbyScreen\.mine_chat_on'\)/);
  });

  it('a refusal while hidden is said: the host shows the controller\'s notice for an ask and for a line', () => {
    expect(SRC).toMatch(/key: r\.notice \?\? 'ask_expired'/);
    expect(SRC).toMatch(/const r = await screen\.say\(text\);\s*\n\s*if \(r\?\.notice\) setNotice\(\{ key: r\.notice \}\)/);
  });

  it('hidden: Vragen paints nearby-ask-off from the shared askOff (no composer), with the existing acts', () => {
    const body = nearbyScreenBody();
    expect(body).toMatch(/const \{ tabs, defaultTab, chatOff, askOff \} = nearbyTabs\(model\)/);
    const part = body.slice(body.indexOf("'nearby-ask-off': () =>"), body.indexOf("'nearby-ask-field': () =>"));
    expect(part).toMatch(/testID="nearby-ask-off"/);
    expect(part).toMatch(/circle\.nearbyScreen\.ask_hidden_line/);
    expect(part).toMatch(/unquiet: \(\) => onSetQuiet\?\.\(false\)/);
    expect(part).not.toMatch(/nearby-ask-compose/);
    expect(SRC).toMatch(/key: 'card_shown'[^\n]*key: r\.notice \?\? 'ask_expired'/);
  });

  it('each tab label carries its count from the shared nearbyTabNews', () => {
    const body = nearbyScreenBody();
    expect(body).toMatch(/nearbyTabNews\(model, /);
    expect(body).toMatch(/circle\.nearbyScreen\.tab_with_new/);
    expect(body).toMatch(/\{tabLabel\(tab\)\}/);
  });
});
