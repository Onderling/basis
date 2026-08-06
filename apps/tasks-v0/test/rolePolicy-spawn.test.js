/**
 * buildStandardRolePolicy.canSpawnSubtask — the sub-task spawn capability. The parent's assignee OR master
 * (`master ?? addedBy`) OR a coordinator/admin may spawn under a parent; a plain member who is neither, an
 * observer, and an unknown actor may not. This is the tasks-v0 spawn authority (previously an inline
 * `circle.roles[from]` check in subtasks.js) expressed as a capability the canonical `spawnSubtask` gate reads.
 */
import { describe, it, expect } from 'vitest';

import { buildStandardRolePolicy } from '../src/rolePolicy.js';

const ADMIN = 'webid:admin';
const COORD = 'webid:coord';
const ASSIGNEE = 'webid:assignee';   // a member who owns the parent
const OTHER = 'webid:other';         // a member who does not
const OBS = 'webid:obs';

const policy = buildStandardRolePolicy({
  [ADMIN]: 'admin', [COORD]: 'coordinator', [ASSIGNEE]: 'member', [OTHER]: 'member', [OBS]: 'observer',
});

describe('canSpawnSubtask — item-relative (assignee/master) + role', () => {
  const parent = { id: 'p', type: 'task', assignees: [ASSIGNEE], addedBy: ASSIGNEE };

  it('the parent assignee may spawn', () => {
    expect(policy.canSpawnSubtask(ASSIGNEE, parent)).toBe(true);
  });

  it('the parent master may spawn (master, else addedBy)', () => {
    expect(policy.canSpawnSubtask(OTHER, { id: 'p', type: 'task', assignees: [ASSIGNEE], master: OTHER })).toBe(true);
    expect(policy.canSpawnSubtask(OTHER, { id: 'p', type: 'task', assignees: [ASSIGNEE], addedBy: OTHER })).toBe(true);
  });

  it('admin + coordinator may spawn anywhere', () => {
    expect(policy.canSpawnSubtask(ADMIN, parent)).toBe(true);
    expect(policy.canSpawnSubtask(COORD, parent)).toBe(true);
  });

  it('a member who is neither the parent assignee nor its master may NOT spawn', () => {
    expect(policy.canSpawnSubtask(OTHER, parent)).toBe(false);
  });

  it('an observer and an unknown actor may NOT spawn', () => {
    expect(policy.canSpawnSubtask(OBS, parent)).toBe(false);
    expect(policy.canSpawnSubtask('webid:nobody', parent)).toBe(false);
  });
});
