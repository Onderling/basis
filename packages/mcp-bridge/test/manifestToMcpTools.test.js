/**
 * manifestToMcpTools.test.js — EXPORT direction.
 *
 * Projects the REAL tasks-v0 manifest (op-rich, imported directly) into an MCP
 * tools/list and asserts the structural contract.
 */
import { describe, it, expect } from 'vitest';
import { tasksManifest }        from '../../../apps/tasks-v0/manifest.js';
import { manifestToMcpTools }   from '../src/index.js';

describe('manifestToMcpTools — onderling manifest → MCP tools/list', () => {
  const { tools } = manifestToMcpTools(tasksManifest);

  it('produces one MCP tool per manifest op, in order', () => {
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(tasksManifest.operations.length);
    expect(tools.map((t) => t.name)).toEqual(tasksManifest.operations.map((o) => o.id));
  });

  it('each tool has { name, description, inputSchema:{type:object} }', () => {
    for (const t of tools) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toBeTruthy();
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('derives inputSchema from the op params (addTask)', () => {
    const addTask = tools.find((t) => t.name === 'addTask');
    expect(addTask).toBeTruthy();
    // params: text(required,string), notes(string), dueAt(number), definitionOfDone(string)
    expect(addTask.inputSchema.properties).toMatchObject({
      text:             { type: 'string', minLength: 1 },
      notes:            { type: 'string' },
      dueAt:            { type: 'number' },
      definitionOfDone: { type: 'string' },
    });
    expect(addTask.inputSchema.required).toEqual(['text']);
    // description comes from the op's chat hint (one source of truth).
    expect(addTask.description).toMatch(/task/i);
  });

  it('carries required-id params through (claimTask)', () => {
    const claim = tools.find((t) => t.name === 'claimTask');
    expect(claim.inputSchema.properties.id).toMatchObject({ type: 'string', minLength: 1 });
    expect(claim.inputSchema.required).toEqual(['id']);
  });

  it('empty/absent manifest → empty tools list (pure, no throw)', () => {
    expect(manifestToMcpTools({}).tools).toEqual([]);
    expect(manifestToMcpTools(null).tools).toEqual([]);
    expect(manifestToMcpTools(undefined).tools).toEqual([]);
  });

  it('op with no declared params → permissive object schema', () => {
    const { tools: t2 } = manifestToMcpTools({
      operations: [{ id: 'ping', verb: 'list', appliesTo: { type: 'task' } }],
    });
    expect(t2[0].inputSchema).toEqual({ type: 'object', additionalProperties: true });
    expect(t2[0].description).toMatch(/no declared params|task/i);
  });
});
