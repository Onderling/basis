/**
 * FITNESS: a household bot's commands are the ones its `/help` names. A command is prefixed (`/assistant:invite`) only
 * when two ops the bot OFFERS share it — never because an app's op the bot does not offer (the tasks app's own
 * `/invite`) once collided with it before the bot's map narrowed the catalogue. The admin typed `/invite`, as `/help`
 * says, and was told "only commands here".
 */
import { describe, it, expect } from 'vitest';
import { composeAssistantCatalogue } from '../../src/telegram/assistantCatalogue.js';
import { resolveDispatch } from '../../src/router.js';
import { parseInput } from '../../src/parser.js';

const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });
const resolve = (line) => resolveDispatch(parseInput(line, catalogue, {}), catalogue);

describe('FITNESS: the bot\'s commands are bare', () => {
  it('the admin\'s /invite resolves to the door\'s invite', () => {
    expect(resolve('/invite')).toMatchObject({ kind: 'ready', opId: 'assistant-invite' });
  });

  it('no command on the bot\'s menu is prefixed unless two offered ops share it', () => {
    const menu = catalogue.commandMenu ?? [];
    const bare = (c) => String(c).replace(/^\/[a-z-]+:/, '/');
    const prefixed = menu.filter((e) => String(e.command).includes(':'));
    const clash = prefixed.filter((e) => menu.filter((o) => bare(o.command) === bare(e.command)).length > 1);
    expect(prefixed.map((e) => e.command)).toEqual(clash.map((e) => e.command));
    for (const e of menu.filter((x) => !String(x.command).includes(':'))) {
      expect(resolve(e.command.split(' ')[0]), e.command).not.toMatchObject({ kind: 'unknown' });
    }
  });
});
