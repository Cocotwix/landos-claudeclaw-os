// LandOS low-risk grunt-work helpers — the model-router's safe operational surface.
//
// Each helper routes through gruntComplete() (live routing only) and ALWAYS has a
// deterministic, non-fabricating fallback used when live routing is off, no model
// is available, the model errors, or it returns empty. Every model output is
// labeled a non-authoritative DRAFT. These helpers are for LOW-RISK grunt-work
// only (summaries/classification/extraction/digests/section drafts/market-pulse/
// media) — never high-stakes work, and they NEVER overwrite verified facts (they
// return drafts to the caller; persistence/authority is the caller's decision).

import { gruntComplete, type GruntDeps } from './model-router-grunt.js';
import type { JobRequirements } from './capability-router.js';

export const DRAFT_LABEL = 'Draft — assistant-generated, non-authoritative';

export type GruntMode = 'model' | 'deterministic';

export interface GruntDraft<T = string> {
  value: T;
  mode: GruntMode;
  modelId?: string;
  label: string;
  /** True for any model-generated text (UI must badge it as a draft). */
  assistantGenerated: boolean;
  note?: string;
}

interface RunOpts {
  prompt: string;
  needs: JobRequirements['needs'];
  modality?: JobRequirements['modality'];
}

/** Route a low-risk text task; fall back deterministically on anything but a
 *  clean executed result. Internal — public helpers wrap this. */
async function runGruntText(opts: RunOpts, deterministic: () => string, deps: GruntDeps): Promise<GruntDraft<string>> {
  const det = (note?: string): GruntDraft<string> => ({ value: deterministic(), mode: 'deterministic', label: DRAFT_LABEL, assistantGenerated: false, note });
  const res = await gruntComplete(
    { prompt: opts.prompt, needs: opts.needs, modality: opts.modality, taskType: 'summarization', stakes: 'low', estimatedConfidence: 0.9 },
    deps,
  );
  if (!res.ran) return det();
  if (res.outcome.status !== 'executed' || !res.outcome.result?.text?.trim()) {
    return det(res.outcome.status === 'override_unavailable' ? res.outcome.message : undefined);
  }
  return { value: res.outcome.result.text.trim(), mode: 'model', modelId: res.outcome.executedModelId, label: DRAFT_LABEL, assistantGenerated: true };
}

function firstSentences(text: string, n: number): string {
  const s = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  return s.slice(0, n).join(' ') || text.slice(0, 240);
}

// ── Generic helpers ───────────────────────────────────────────────────────────

export function summarizeDraft(text: string, deps: GruntDeps = {}): Promise<GruntDraft<string>> {
  return runGruntText(
    { prompt: `Summarize the following in 2-3 plain sentences. Do not invent facts.\n\n${text}`, needs: { summarization: 0.7 } },
    () => firstSentences(text, 2),
    deps,
  );
}

export function researchDigestDraft(text: string, deps: GruntDeps = {}): Promise<GruntDraft<string>> {
  return runGruntText(
    { prompt: `Digest the following research into 3-5 plain bullet points. Use only what is present.\n\n${text}`, needs: { researchDigestion: 0.7, summarization: 0.6 } },
    () => firstSentences(text, 4).split(/(?<=[.!?])\s+/).map((s) => `- ${s}`).join('\n'),
    deps,
  );
}

export function reportSectionDraft(section: string, facts: string[], deps: GruntDeps = {}): Promise<GruntDraft<string>> {
  const factBlock = facts.map((f) => `- ${f}`).join('\n');
  return runGruntText(
    { prompt: `Write the "${section}" section as a few plain sentences using ONLY these facts (do not add any):\n${factBlock}`, needs: { summarization: 0.6, structuredOutput: 0.5 } },
    () => `## ${section}\n${factBlock || '- (no facts provided)'}`,
    deps,
  );
}

export function marketPulseDraft(areaFacts: string[], deps: GruntDeps = {}): Promise<GruntDraft<string>> {
  const factBlock = areaFacts.map((f) => `- ${f}`).join('\n');
  return runGruntText(
    { prompt: `Write a short "local area market pulse" (2-3 sentences) using ONLY these area facts. This is local-area context, NOT parcel-verified. Do not invent numbers:\n${factBlock}`, needs: { summarization: 0.6, researchDigestion: 0.6 } },
    () => `Local Area Context (not parcel-verified): ${areaFacts.join('; ') || 'no signals connected'}.`,
    deps,
  );
}

/** Classify text into one of `labels`. Deterministic fallback = first label whose
 *  token appears in the text (case-insensitive), else 'unclassified'. */
export async function classifyDraft(text: string, labels: string[], deps: GruntDeps = {}): Promise<GruntDraft<string>> {
  const det = () => {
    const lc = text.toLowerCase();
    return labels.find((l) => lc.includes(l.toLowerCase())) ?? 'unclassified';
  };
  const res = await gruntComplete(
    { prompt: `Classify the text into EXACTLY one of: ${labels.join(', ')}. Reply with only the label.\n\n${text}`, needs: { classification: 0.7 }, taskType: 'classification', stakes: 'low', estimatedConfidence: 0.9 },
    deps,
  );
  if (!res.ran || res.outcome.status !== 'executed' || !res.outcome.result?.text?.trim()) {
    return { value: det(), mode: 'deterministic', label: DRAFT_LABEL, assistantGenerated: false };
  }
  const out = res.outcome.result.text.trim();
  // Constrain model output to the allowed label set; else deterministic.
  const matched = labels.find((l) => out.toLowerCase().includes(l.toLowerCase()));
  return matched
    ? { value: matched, mode: 'model', modelId: res.outcome.executedModelId, label: DRAFT_LABEL, assistantGenerated: true }
    : { value: det(), mode: 'deterministic', label: DRAFT_LABEL, assistantGenerated: false, note: 'model output not in label set; used deterministic' };
}

/** Extract named fields. Deterministic fallback returns nulls (NEVER fabricates). */
export async function extractDraft(text: string, fields: string[], deps: GruntDeps = {}): Promise<GruntDraft<Record<string, string | null>>> {
  const empty = Object.fromEntries(fields.map((f) => [f, null])) as Record<string, string | null>;
  const res = await gruntComplete(
    { prompt: `Extract these fields as JSON (use null if not present, do not guess): ${fields.join(', ')}.\n\n${text}`, needs: { extraction: 0.7, structuredOutput: 0.6 }, taskType: 'metadata_extraction', stakes: 'low', estimatedConfidence: 0.9 },
    deps,
  );
  if (!res.ran || res.outcome.status !== 'executed' || !res.outcome.result?.text?.trim()) {
    return { value: empty, mode: 'deterministic', label: DRAFT_LABEL, assistantGenerated: false };
  }
  try {
    const m = res.outcome.result.text.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) as Record<string, unknown> : {};
    const value = Object.fromEntries(fields.map((f) => [f, typeof parsed[f] === 'string' ? (parsed[f] as string) : null])) as Record<string, string | null>;
    return { value, mode: 'model', modelId: res.outcome.executedModelId, label: DRAFT_LABEL, assistantGenerated: true };
  } catch {
    return { value: empty, mode: 'deterministic', label: DRAFT_LABEL, assistantGenerated: false, note: 'model output not parseable; used deterministic empty' };
  }
}

// ── Media grunt-work interface (OCR / audio / video / image) ───────────────────
// Interface + safe default only. Real media processing needs a multimodal-capable
// LOCAL provider wired to accept media input; until then this reports unavailable
// (never fabricates a transcript/extraction). Modality routes to local Gemma-12b
// (vision/audio) when live + available; otherwise deterministic unavailable.

export type MediaKind = 'ocr' | 'audio' | 'video' | 'image';
const MEDIA_MODALITY: Record<MediaKind, JobRequirements['modality']> = { ocr: 'vision', audio: 'audio', video: 'audio', image: 'vision' };
const MEDIA_NEED: Record<MediaKind, JobRequirements['needs']> = {
  ocr: { ocr: 0.5, vision: 0.4 }, audio: { audio: 0.4 }, video: { audio: 0.4, vision: 0.4 }, image: { vision: 0.4 },
};

export interface MediaGruntInput {
  kind: MediaKind;
  /** A text description / transcript-so-far / prompt. Binary media wiring is a
   *  later pass; passing raw media requires a multimodal client adapter. */
  prompt: string;
}

export async function mediaGruntDraft(input: MediaGruntInput, deps: GruntDeps = {}): Promise<GruntDraft<string>> {
  const unavailable = (): GruntDraft<string> => ({
    value: '', mode: 'deterministic', label: DRAFT_LABEL, assistantGenerated: false,
    note: `media (${input.kind}) grunt-work unavailable: enable live routing and a multimodal local provider (e.g. Gemma-12b via Ollama). No transcript/extraction fabricated.`,
  });
  const res = await gruntComplete(
    { prompt: input.prompt, needs: MEDIA_NEED[input.kind], modality: MEDIA_MODALITY[input.kind], taskType: 'metadata_extraction', stakes: 'low', estimatedConfidence: 0.9 },
    deps,
  );
  if (!res.ran || res.outcome.status !== 'executed' || !res.outcome.result?.text?.trim()) return unavailable();
  return { value: res.outcome.result.text.trim(), mode: 'model', modelId: res.outcome.executedModelId, label: DRAFT_LABEL, assistantGenerated: true };
}

/** Registry of router-enabled helpers, for dashboard visibility. */
export const GRUNT_HELPERS = [
  { id: 'summarize', label: 'Summarization', needs: ['summarization'] },
  { id: 'classify', label: 'Classification', needs: ['classification'] },
  { id: 'extract', label: 'Extraction', needs: ['extraction', 'structuredOutput'] },
  { id: 'research_digest', label: 'Research digestion', needs: ['researchDigestion'] },
  { id: 'report_section', label: 'Report-section draft', needs: ['summarization', 'structuredOutput'] },
  { id: 'market_pulse', label: 'Market pulse draft', needs: ['summarization', 'researchDigestion'] },
  { id: 'county_narration', label: 'County metric narration', needs: ['summarization', 'researchDigestion'] },
  { id: 'media_ocr', label: 'Media/OCR grunt-work', needs: ['ocr', 'vision', 'audio'] },
] as const;
