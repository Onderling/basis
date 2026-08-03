# @onderling/mcp-bridge

**The boundary where a non-Onderling AI tool can call an Onderling op — through the same gate a person goes
through.** Bidirectional: it projects an app's manifest ops into an MCP `tools/list`, and maps an incoming
`tools/call` back to `{opId, args}` dispatched **through the capability gate**. An ungranted, revoked or
unknown call surfaces as an MCP `isError` with the skill **not executed**.

## Why it exists

The platform's central sentence names it directly (`CLAUDE.md`, `docs/architecture.md`, `docs/glossary.md`):

> The functionality the op names resolves *wherever it lives*: a local handler · an external agent · a
> model · the Solid pod · an **MCP service** · a scheduled job.

It is the outermost rung of the extensibility ladder in `plans/PLAN-capability-arc.md` §4 — Tier 1
pure-manifest, **Tier 2 remote-handler (this)**, Tier 3 sandboxed WASM. And it is one half of a deliberate
pair, from `plans/design/DESIGN-feedback-surface-contract.md`:

> MCP is the *"any LLM/bot"* boundary; A2A is the *"Onderling agent"* boundary — **complementary, not
> competing.**

That is the point worth holding on to: A2A lets *our* agents talk to each other. MCP lets **Claude Desktop,
or any other MCP client, drive this app as a tool** — without being one of us, and without getting past the
gate. Same `{opId, args}` waist, same default-deny.

It reuses `paramsToJsonSchema` — the same projector behind the chat/LLM tool catalogue — so the MCP surface
and the in-app surface cannot drift into two descriptions of one op.

## Status — built, correct, and not yet reachable (2026-08-03)

The protocol half is done: JSON-RPC 2.0 / NDJSON framing, the `initialize` → `initialized` → `tools/*`
lifecycle, and `createStdioMcpServer` binding it all to an injected `{onData, write}` line stream that is
1:1 with real child stdio. The tests prove an ungranted call is refused.

**What is missing is a composition root.** Nothing binds `process.stdin`/`stdout` to it. Its intended first
consumer — the feedback bot exposing its surface to non-Onderling LLMs — **moved out of this repo** in the
feedback split (2026-07-16). That is not abandonment; the work continues with the feedback app.

Wiring it means, in order:

1. a Node entrypoint binding real stdio to `createStdioMcpServer({ agent, manifest })` — candidates are
   `apps/companion-node` (already boots agent + registry + vault + relay) or a `bin` alongside
   `apps/tasks-v0/bin/`, which is manifest-rich;
2. binding ops to remote handlers and issuing a grant (`RemoteHandlerRegistry.register` +
   `grantRemoteCapability` in `@onderling/secure-agent`) — without this every call correctly refuses;
3. the deferred auth-token handshake.

## ⚠ Before it goes live: the egress gate

**An MCP tool call is the first real EXTERNAL-EGRESS op this platform will have.** Everything until now
resolves inside the user's own trust boundary. The egress gate is already built and deliberately not wrapped
live, because no external op existed to wrap. **Install it on this path in the same slice that makes MCP
reachable** — not after. A tool boundary that ships before its gate is how user data leaves without anyone
deciding it should.
