# Plan: Qwen + Memory + Conversational Polish

## Goal

Run a local Qwen model that behaves more like a polished assistant: persistent memory across sessions, clarification questions when intent is ambiguous, and tool use when helpful.

## Stack

- **Model serving:** vLLM (production) or Ollama (simpler, good for prototyping). Both expose an OpenAI-compatible `/v1/chat/completions` endpoint.
- **Base model:** Qwen3 (size depending on hardware — 8B is comfortable on a single 24GB GPU, 32B needs more).
- **Memory layer:** Mem0 (Apache 2.0, drop-in) — start here. Swap to Letta later if you need agent-managed tiered memory.
- **Agent scaffolding:** Qwen-Agent (native fit) or LangGraph (more general). Pick one; don't combine.
- **Storage backend for Mem0:** Qdrant or Chroma running locally in Docker.

## Architecture

```
User ↔ Agent loop (Qwen-Agent or LangGraph)
         ├── LLM call → vLLM/Ollama → Qwen
         ├── Memory ops → Mem0 → Qdrant
         └── Tools (optional: web search, code exec, file I/O)
```

## Build order

1. **Get the model serving working.** Stand up vLLM or Ollama with Qwen, confirm `/v1/chat/completions` responds. Test with curl before touching anything else.
2. **Wire up a bare chat loop.** Plain Python using the OpenAI SDK pointed at the local endpoint. Multi-turn working in-process (just a list of messages). No memory yet.
3. **Add Mem0.** Initialize with the local model as the extractor LLM and a local vector store. On each user turn: retrieve relevant memories, inject them into the system prompt, send to LLM, then write new facts to Mem0 after the response.
4. **Write the system prompt.** This is where the "Claude-like" behaviour actually comes from. It should cover:
    - When to ask clarifying questions vs. proceed with reasonable assumptions (the bar: ask only when ambiguity would meaningfully change the answer).
    - Honesty about uncertainty.
    - Formatting preferences (concise prose by default, lists only when useful).
    - How to use retrieved memories naturally without making it weird.
5. **Add tool use** (optional). If wanted, switch from raw OpenAI SDK to Qwen-Agent or LangGraph so function calling is handled cleanly. Start with one tool (e.g., web search) before adding more.
6. **Persistence and session handling.** Decide on a `user_id` scheme for Mem0 so memories scope correctly across sessions.

## Key decisions to make upfront

- **Ollama vs vLLM** — Ollama for fast iteration, vLLM if you'll eventually serve more than one user.
- **Qwen-Agent vs LangGraph** — Qwen-Agent if you're staying on Qwen and want minimal glue; LangGraph if you want model-portability later.
- **Where memories live** — local-only (Qdrant in Docker) is the safe default.

## Things to flag for Claude Code

- Don't pip-install both Qwen-Agent and LangChain unless actually needed; their dependency trees can fight.
- Mem0's default extractor uses OpenAI; explicitly configure it to use your local Qwen endpoint.
- The system prompt is the highest-leverage file in the project — keep it in version control and iterate on it deliberately.
- Test memory recall with a fresh process between sessions, not just within one run.

That's enough for Claude Code to scaffold the project and start filling in pieces. Want me to tighten any section or add evaluation/testing notes?