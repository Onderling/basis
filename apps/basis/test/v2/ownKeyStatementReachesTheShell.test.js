/**
 * A KEY STATEMENT THIS DEVICE WRITES REACHES ITS OWN KEY STORE. A shell refreshes its key-event store when a key
 * statement ARRIVES (the receive handler, the catch-up); one written here — a rotation on the key lane, as a re-key that
 * waited for its catch-up runs — arrives from nobody, so the device that rotated kept sealing from a chain without its
 * own new version (after a re-key: no key for its new address at all). The shared lane composition hands the shell's
 * `keyChange` to the agent's own-statement listener; the relay walk in fullDeviceRekey crosses the agent's side.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildCircleLanes } from '../../src/v2/circleLanes.js';

const agentWithListener = () => {
  const listeners = new Set();
  return {
    listeners,
    sendPeerMessage: vi.fn(),
    onOwnKeyStatement: vi.fn((fn) => { listeners.add(fn); return () => listeners.delete(fn); }),
  };
};

describe('the shared lane composition', () => {
  it("hands the shell's keyChange to the agent's own key statements", async () => {
    const agent = agentWithListener();
    const keyChange = vi.fn();
    buildCircleLanes({ agent, on: { keyChange } });
    expect(agent.listeners.size, 'nothing listens to what this device writes').toBe(1);
    for (const fn of agent.listeners) await fn('circle-1');
    expect(keyChange).toHaveBeenCalledWith('circle-1');
  });

  it('a shell without a keyChange subscribes nothing', () => {
    const agent = agentWithListener();
    buildCircleLanes({ agent });
    expect(agent.onOwnKeyStatement).not.toHaveBeenCalled();
  });
});
