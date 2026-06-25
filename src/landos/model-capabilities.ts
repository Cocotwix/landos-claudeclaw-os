// LandOS model capability profiles.
//
// The router chooses by the CAPABILITIES a job requires, not by a fixed task
// label. Each model carries a profile across the dimensions below. These are
// DECLARED, operator-tunable capability estimates (what a model can do) — not a
// global "best model" ranking, and the operator can always override the router
// (see model-override.ts). Scores are 0..1; for cost/speed/privacy/
// localAvailability, higher = more favorable for routing (1 = free / fastest /
// fully private / always-on local).

export const CAPABILITY_DIMENSIONS = [
  'reasoning',
  'longContext',
  'structuredOutput',
  'coding',
  'classification',
  'extraction',
  'summarization',
  'researchDigestion',
  'vision',
  'audio',
  'video',
  'speech',
  'ocr',
  'functionCalling',
  'toolUse',
  'speed',
  'cost',
  'privacy',
  'localAvailability',
  'reliability',
  'confidenceCalibration',
] as const;

export type CapabilityDimension = (typeof CAPABILITY_DIMENSIONS)[number];
export type CapabilityProfile = Record<CapabilityDimension, number>;

export interface ModelCapabilityEntry {
  modelId: string;
  /** Execution provider that serves this model id (see model-execution.ts). */
  provider: 'anthropic' | 'openai' | 'google' | 'ollama' | 'openrouter';
  runtime: 'local' | 'cloud';
  openSource: boolean;
  profile: CapabilityProfile;
}

// Helper to build a profile with explicit values (any omitted dim defaults 0).
function profile(p: Partial<CapabilityProfile>): CapabilityProfile {
  const full = {} as CapabilityProfile;
  for (const d of CAPABILITY_DIMENSIONS) full[d] = p[d] ?? 0;
  return full;
}

// Profiles are a superset of MODEL_REGISTRY (kept separate so the existing
// neutral registry/suggestion + their tests are untouched). gemma-4-* are served
// locally via Ollama; gpt is served via OpenAI or OpenRouter; gemini via Google.
export const MODEL_CAPABILITIES: readonly ModelCapabilityEntry[] = [
  {
    modelId: 'gemma-4-e4b', provider: 'ollama', runtime: 'local', openSource: true,
    profile: profile({
      reasoning: 0.5, longContext: 0.3, structuredOutput: 0.6, coding: 0.5,
      classification: 0.8, extraction: 0.8, summarization: 0.8, researchDigestion: 0.7,
      vision: 0, audio: 0, video: 0, speech: 0, ocr: 0, functionCalling: 0.4, toolUse: 0.4,
      speed: 0.95, cost: 1, privacy: 1, localAvailability: 1, reliability: 0.8, confidenceCalibration: 0.6,
    }),
  },
  {
    modelId: 'gemma-4-12b-q4', provider: 'ollama', runtime: 'local', openSource: true,
    profile: profile({
      reasoning: 0.6, longContext: 0.35, structuredOutput: 0.65, coding: 0.55,
      classification: 0.82, extraction: 0.82, summarization: 0.82, researchDigestion: 0.75,
      vision: 0.6, audio: 0.5, video: 0.3, speech: 0.35, ocr: 0.5, functionCalling: 0.5, toolUse: 0.5,
      speed: 0.85, cost: 1, privacy: 1, localAvailability: 1, reliability: 0.8, confidenceCalibration: 0.6,
    }),
  },
  {
    modelId: 'gpt', provider: 'openai', runtime: 'cloud', openSource: false,
    profile: profile({
      reasoning: 0.9, longContext: 0.85, structuredOutput: 0.9, coding: 0.9,
      classification: 0.85, extraction: 0.85, summarization: 0.85, researchDigestion: 0.85,
      vision: 0.85, audio: 0.7, video: 0.5, speech: 0.7, ocr: 0.8, functionCalling: 0.9, toolUse: 0.9,
      speed: 0.7, cost: 0.4, privacy: 0.3, localAvailability: 0, reliability: 0.9, confidenceCalibration: 0.8,
    }),
  },
  {
    modelId: 'gemini', provider: 'google', runtime: 'cloud', openSource: false,
    profile: profile({
      reasoning: 0.85, longContext: 0.95, structuredOutput: 0.85, coding: 0.8,
      classification: 0.85, extraction: 0.85, summarization: 0.85, researchDigestion: 0.85,
      vision: 0.9, audio: 0.9, video: 0.9, speech: 0.85, ocr: 0.85, functionCalling: 0.85, toolUse: 0.85,
      speed: 0.8, cost: 0.5, privacy: 0.3, localAvailability: 0, reliability: 0.85, confidenceCalibration: 0.75,
    }),
  },
  {
    modelId: 'claude', provider: 'anthropic', runtime: 'cloud', openSource: false,
    profile: profile({
      reasoning: 0.95, longContext: 0.95, structuredOutput: 0.9, coding: 0.9,
      classification: 0.85, extraction: 0.85, summarization: 0.88, researchDigestion: 0.9,
      vision: 0.8, audio: 0.2, video: 0.3, speech: 0, ocr: 0.75, functionCalling: 0.9, toolUse: 0.9,
      speed: 0.65, cost: 0.45, privacy: 0.3, localAvailability: 0, reliability: 0.95, confidenceCalibration: 0.85,
    }),
  },
];

export function getCapabilityEntry(modelId: string): ModelCapabilityEntry | undefined {
  return MODEL_CAPABILITIES.find((m) => m.modelId === modelId);
}

/** A model meets a job's needs when every REQUIRED capability is at/above the
 *  requested minimum level. Dimensions not requested are ignored. */
export function meetsNeeds(p: CapabilityProfile, needs: Partial<CapabilityProfile>): boolean {
  return (Object.keys(needs) as CapabilityDimension[]).every((d) => p[d] >= (needs[d] ?? 0));
}

/** Largest shortfall of `candidate` vs `reference` across the requested
 *  capabilities (0 when candidate is >= reference on all of them). Used to decide
 *  whether a local/open model is "close enough" to a stronger closed model. */
export function capabilityGap(
  candidate: CapabilityProfile,
  reference: CapabilityProfile,
  dims: CapabilityDimension[],
): number {
  let gap = 0;
  for (const d of dims) gap = Math.max(gap, reference[d] - candidate[d]);
  return gap;
}
