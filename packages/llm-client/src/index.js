/**
 * @onderling/llm-client — public entry point.
 */

export { LlmClient } from './LlmClient.js';
export {
  ollamaProvider,
  parseOpenAIChatResponse,
  parseLooseToolCall,
  parseLooseToolCalls,
  stripJsonBlobs,
  OLLAMA_DEFAULT_MODEL,
} from './providers/ollama.js';
export { mockProvider } from './providers/mock.js';

// Configurable endpoint block — pick an endpoint (baseUrl + model + auth/headers)
// by name / customer, composed with the existing provider constructors.

// Per-customer usage metering — injectable sink + in-memory aggregator + the
// token-extraction / estimate helpers.
export {
  createUsageAggregator,
  extractTokenCounts,
  usageForCompletion,
  usageForEmbedding,
} from './metering.js';

// Embeddings (F-retrieve tier-2 / NL search) — sibling of the chat client.
// `EmbeddingClient` (class, bare-vector return) is the original; pod-search V2
// builds against `createEmbeddingsClient` (§3.1: `{ vectors, modelId, dim }` +
// coded errors). Both share the same provider-agnostic + audit-hook composition.
export { EmbeddingClient, createEmbeddingsClient } from './EmbeddingClient.js';
export {
  openaiEmbeddingsProvider,
  parseEmbeddingsResponse,
  EMBEDDINGS_DEFAULT_MODEL,
} from './providers/embeddings.js';
export {
  ollamaEmbedProvider,
  parseOllamaEmbedResponse,
  OLLAMA_EMBED_DEFAULT_MODEL,
} from './providers/ollama-embed.js';
export { mockEmbeddingsProvider } from './providers/mockEmbeddings.js';
