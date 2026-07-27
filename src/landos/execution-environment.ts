// LandOS Execution Environment layer — the abstraction ABOVE providers.
//
// Architecture: Execution Environment -> Provider -> Model -> Capability Profile
// -> Model Router -> Executive Agent. The router does not care WHERE a model runs;
// it cares whether the model is available, healthy, capable, appropriate, and
// configured. An execution environment is the runtime substrate a provider lives
// in (local box, vendor cloud, an aggregator, a local server, MCP, ...).

export type ExecutionEnvironmentKind =
  | 'local'       // models on the operator's machine (e.g. Ollama)
  | 'cloud'       // first-party vendor APIs (Anthropic, OpenAI, Google, ...)
  | 'openrouter'  // cloud aggregator (OpenAI-compatible)
  | 'lmstudio'    // local server (OpenAI-compatible)
  | 'vllm'        // local/self-hosted high-throughput server
  | 'hermes'      // OPTIONAL Hermes-style OpenAI-compatible endpoint
  | 'mcp';        // models exposed via an MCP server

export interface ExecutionEnvironment {
  id: string;
  kind: ExecutionEnvironmentKind;
  label: string;
  /** Where the compute physically runs. */
  execution: 'local' | 'cloud';
}

// The default catalog. Providers attach to one of these by environmentId. New
// environments are added here without touching routing logic.
export const EXECUTION_ENVIRONMENTS: readonly ExecutionEnvironment[] = [
  { id: 'local-ollama', kind: 'local', label: 'Local (Ollama)', execution: 'local' },
  { id: 'cloud', kind: 'cloud', label: 'Cloud (vendor APIs)', execution: 'cloud' },
  { id: 'openrouter', kind: 'openrouter', label: 'OpenRouter', execution: 'cloud' },
  { id: 'lmstudio', kind: 'lmstudio', label: 'LM Studio', execution: 'local' },
  { id: 'vllm', kind: 'vllm', label: 'vLLM', execution: 'local' },
  // OPTIONAL. Present as a selectable environment so an operator CAN point a
  // Hermes-style OpenAI-compatible endpoint at LandOS. Nothing requires it: with
  // no endpoint configured the provider is simply not installed.
  { id: 'hermes', kind: 'hermes', label: 'Hermes (optional, OpenAI-compatible)', execution: 'local' },
  { id: 'mcp', kind: 'mcp', label: 'MCP', execution: 'cloud' },
];

export function getExecutionEnvironment(id: string): ExecutionEnvironment | undefined {
  return EXECUTION_ENVIRONMENTS.find((e) => e.id === id);
}
