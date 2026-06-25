// LandOS model execution dispatch.
//
// Maps a chosen model id -> the provider client that can run it. Clients are
// CREDENTIAL-INJECTED: this module never reads .env. A client is available() only
// when its key/host was injected, so with no credentials (tests) every cloud/
// local client is unavailable and nothing is called. Real call bodies are present
// but only reachable when credentials exist — never exercised in tests.
//
// Providers: claude (injected SDK runner), openai, openrouter (OpenAI-compatible
// via baseURL), gemini (reuses ./gemini.ts), ollama (local HTTP, serves Gemma).

import { generateContent } from '../gemini.js';

export interface CompletionRequest {
  prompt: string;
  system?: string;
  maxTokens?: number;
}
export interface CompletionResult {
  text: string;
  modelId: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ModelClient {
  readonly provider: string;
  servesModel(modelId: string): boolean;
  available(): boolean;
  complete(modelId: string, req: CompletionRequest): Promise<CompletionResult>;
}

// ── Claude (delegates to an injected runner; keeps agent SDK out of dispatch) ──
export class ClaudeClient implements ModelClient {
  readonly provider = 'anthropic';
  constructor(private runner?: (modelId: string, req: CompletionRequest) => Promise<CompletionResult>) {}
  servesModel(modelId: string) { return modelId === 'claude'; }
  available() { return !!this.runner; }
  async complete(modelId: string, req: CompletionRequest): Promise<CompletionResult> {
    if (!this.runner) throw new Error('claude runner not configured');
    return this.runner(modelId, req);
  }
}

// ── OpenAI / OpenRouter (OpenAI-compatible) ───────────────────────────────────
export class OpenAICompatibleClient implements ModelClient {
  readonly provider: string;
  constructor(
    opts: { provider: 'openai' | 'openrouter'; apiKey?: string; baseURL?: string; defaultModelName?: string; serves?: string[] },
  ) {
    this.provider = opts.provider;
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL;
    this.defaultModelName = opts.defaultModelName ?? (opts.provider === 'openrouter' ? 'openai/gpt-4o-mini' : 'gpt-4o-mini');
    this.serves = opts.serves ?? ['gpt'];
  }
  private apiKey?: string;
  private baseURL?: string;
  private defaultModelName: string;
  private serves: string[];
  servesModel(modelId: string) { return this.serves.includes(modelId); }
  available() { return !!this.apiKey; }
  async complete(modelId: string, req: CompletionRequest): Promise<CompletionResult> {
    if (!this.apiKey) throw new Error(`${this.provider} api key not configured`);
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey, ...(this.baseURL ? { baseURL: this.baseURL } : {}) });
    const params: any = {
      model: this.defaultModelName,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.prompt },
      ],
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    };
    const r: any = await client.chat.completions.create(params);
    return {
      text: r.choices?.[0]?.message?.content ?? '',
      modelId,
      usage: { inputTokens: r.usage?.prompt_tokens, outputTokens: r.usage?.completion_tokens },
    };
  }
}

// ── Gemini (reuses the existing, tested gemini.ts path) ────────────────────────
export class GeminiClient implements ModelClient {
  readonly provider = 'google';
  constructor(private opts: { apiKeyPresent: boolean; defaultModelName?: string } = { apiKeyPresent: false }) {}
  servesModel(modelId: string) { return modelId === 'gemini'; }
  available() { return this.opts.apiKeyPresent; }
  async complete(modelId: string, req: CompletionRequest): Promise<CompletionResult> {
    if (!this.opts.apiKeyPresent) throw new Error('gemini api key not configured');
    const prompt = req.system ? `${req.system}\n\n${req.prompt}` : req.prompt;
    const text = await generateContent(prompt, this.opts.defaultModelName);
    return { text, modelId };
  }
}

// ── Ollama (local; serves Gemma open-source weights) ──────────────────────────
export class OllamaClient implements ModelClient {
  readonly provider = 'ollama';
  constructor(private opts: { host?: string; serves?: string[] } = {}) {
    this.serves = opts.serves ?? ['gemma-4-e4b', 'gemma-4-12b-q4'];
  }
  private serves: string[];
  servesModel(modelId: string) { return this.serves.includes(modelId); }
  available() { return !!this.opts.host; }
  async complete(modelId: string, req: CompletionRequest): Promise<CompletionResult> {
    if (!this.opts.host) throw new Error('ollama host not configured');
    const prompt = req.system ? `${req.system}\n\n${req.prompt}` : req.prompt;
    const res = await fetch(`${this.opts.host.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelId, prompt, stream: false }),
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
    const j: any = await res.json();
    return { text: j.response ?? '', modelId };
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────
export class ModelExecutionRegistry {
  constructor(private clients: ModelClient[]) {}
  /** First AVAILABLE client that serves this model id. */
  clientFor(modelId: string): ModelClient | undefined {
    return this.clients.find((c) => c.servesModel(modelId) && c.available());
  }
  /** Availability predicate to feed routeByCapability({ available }). */
  availability(): (modelId: string) => boolean {
    return (modelId: string) => this.clients.some((c) => c.servesModel(modelId) && c.available());
  }
  /** All model ids served by at least one AVAILABLE client. */
  availableModelIds(allModelIds: string[]): string[] {
    const pred = this.availability();
    return allModelIds.filter(pred);
  }
  async complete(modelId: string, req: CompletionRequest): Promise<CompletionResult> {
    const client = this.clientFor(modelId);
    if (!client) throw new Error(`no available execution client for model "${modelId}"`);
    return client.complete(modelId, req);
  }
}
