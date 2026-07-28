/**
 * @onderling/mcp-bridge — bidirectional bridge between the Model Context Protocol
 * (MCP) and Onderling's gated `{opId, args}` dispatch (the #63 MCP-integration tail).
 *
 * Two directions, one contract (the manifest):
 *   • EXPORT  — `manifestToMcpTools(manifest)` projects an app's ops into an
 *     MCP `tools/list` (pure, no I/O).
 *   • INBOUND — `handleMcpToolCall(agent, toolCall, opts)` maps an MCP
 *     `tools/call` to `{opId, args}` and dispatches it THROUGH the capability
 *     gate (the same `callSkill`/`dispatchRemoteOp` path #63 uses). A denied
 *     or unknown call returns an MCP `{ isError:true }` — never a silent run.
 *
 * `createMcpServer` wires both over an INJECTED abstract message transport.
 * `createStdioMcpServer` adds the concrete layer below it — JSON-RPC 2.0 /
 * NDJSON framing + the MCP `initialize` handshake + capability negotiation —
 * over an INJECTED line stream. Binding that stream seam to a REAL child-process
 * stdio pipe (and real HTTP+SSE) is the remaining DEFERRED step (see mcpSession.js).
 */

export { manifestToMcpTools } from './manifestToMcpTools.js';
export { handleMcpToolCall }  from './handleMcpToolCall.js';
export { createMcpServer, createLoopbackPair } from './createMcpServer.js';
export { mcpResult, mcpError, partsFromArguments } from './mcpShapes.js';

// JSON-RPC 2.0 / NDJSON framing codec.
export {
  JSONRPC_VERSION, JsonRpcErrorCode,
  jsonRpcRequest, jsonRpcNotification, jsonRpcResult, jsonRpcError,
  isRequest, isNotification, isResponse,
  encodeLine, createNdjsonDecoder,
} from './jsonRpc.js';

// MCP lifecycle (initialize handshake) + the injected-stream stdio seam.
export {
  createMcpSession, createStdioMcpServer,
  createDuplexLoopback, createStdioTestClient,
  PROTOCOL_VERSIONS,
} from './mcpSession.js';
