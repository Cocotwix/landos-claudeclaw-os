// LandOS — Acquisitions: call-prep + follow-up DRAFTS + playbook + R2 training
// readiness. Everything here is generated text for TYLER to use — nothing is ever
// sent, no message leaves the system, no CRM/GHL write, no paid API. Drafts use
// Tyler's plain, low-pressure acquisition style; never fake certainty, never make
// unverified claims, preserve leverage.

import type { AcquisitionState, AcquisitionNextAction } from './acquisitions.js';
import { knowledgeStoreStatus } from './knowledge-store-r2.js';

export interface DealContextForPrep {
  ddParcelVerified?: boolean;
  identityTier?: string;
  ddCompletenessLabel?: string;
  marketBand?: string | null;        // e.g. "$10,700–$78,125/ac (p25–p75)"
  topRiskFlags?: string[];
  topMissingDdFacts?: string[];
  propertyType?: string;
}

export interface CallPrepBrief {
  openingFrame: string;
  whatWeKnow: string[];
  whatToLearn: string[];
  sellerPsychology: string[];
  keyQuestions: string[];
  riskTopicsToClarify: string[];
  likelyObjections: string[];
  suggestedLanguage: string[];
  doNotSay: string[];
  desiredOutcome: string;
}

/** Build a concise, human call-prep brief from seller profile + DD/market context. */
export function buildCallPrep(s: AcquisitionState, na: AcquisitionNextAction, ctx: DealContextForPrep = {}): CallPrepBrief {
  const p = s.profile;
  const name = p.name ? p.name.split(/[ ,]/)[0] : 'them';
  const guarded = /negative|guarded/i.test(s.discovery[0]?.emotionalTone ?? '');
  const whatWeKnow: string[] = [];
  if (p.motivation) whatWeKnow.push(`Motivation: ${p.motivation}`);
  if (p.timeline) whatWeKnow.push(`Timeline: ${p.timeline}`);
  if (p.askingPrice) whatWeKnow.push(`Price talk: ${p.askingPrice} (seller-stated)`);
  if (p.decisionMakers) whatWeKnow.push(`Decision-makers: ${p.decisionMakers}`);
  if (ctx.propertyType) whatWeKnow.push(`Inferred property type: ${ctx.propertyType}`);
  if (ctx.marketBand) whatWeKnow.push(`Comp band (context only, do not quote): ${ctx.marketBand}`);
  if (ctx.identityTier) whatWeKnow.push(`Parcel identity: ${ctx.identityTier}`);
  if (whatWeKnow.length === 0) whatWeKnow.push('Very little yet — treat this as a discovery conversation.');

  const whatToLearn: string[] = [];
  if (!p.motivation) whatToLearn.push('Why they are thinking about selling (the real reason).');
  if (!p.timeline) whatToLearn.push('Their timeline — how soon, and what is driving it.');
  if (!p.askingPrice) whatToLearn.push('Any number they have in mind (let them say it first).');
  if (!p.decisionMakers) whatToLearn.push('Who else is part of the decision.');
  (ctx.topMissingDdFacts ?? []).slice(0, 4).forEach((f) => whatToLearn.push(`${f} (ask, then verify officially).`));
  if (whatToLearn.length === 0) whatToLearn.push('Confirm nothing has changed; move toward next steps.');

  return {
    openingFrame: guarded
      ? `Keep it low-key. Reference why you're calling about the property, then ask an easy open question and let ${name} talk.`
      : `Friendly and direct: thank ${name} for their time, confirm you're calling about the property, and ask what has them considering selling.`,
    whatWeKnow,
    whatToLearn,
    sellerPsychology: [
      guarded ? 'Reads as guarded — earn trust before any numbers.' : 'Reads as open — keep it conversational, don\'t rush.',
      /high/i.test(s.discovery[0]?.urgency ?? '') ? 'Time pressure on their side — speed + certainty are your value.' : 'No urgency signal — patience beats pressure.',
      p.personalityNotes ? `Notes: ${p.personalityNotes}` : 'Mirror their pace and words; let silence do work.',
    ],
    keyQuestions: [
      'What has you thinking about selling this one?',
      'How soon would you want something to happen?',
      'Have you had it appraised or gotten any offers?',
      'Is anyone else part of the decision?',
      ...(s.discovery[0]?.unansweredQuestions ?? []).slice(0, 2),
    ].filter(Boolean),
    riskTopicsToClarify: [
      ...(ctx.topRiskFlags ?? []).slice(0, 3),
      ...(s.discovery[0]?.risks ?? []).slice(0, 3),
      ...(p.verificationNeeded ?? []).slice(0, 2),
    ].filter(Boolean),
    likelyObjections: (p.objections ?? []).length ? (p.objections as string[]) : ['"I think it\'s worth more."', '"I need to think about it."', '"Why so low?"'],
    suggestedLanguage: [
      '"I\'m not here to pressure you — I just want to understand what you\'re working with."',
      '"If the numbers make sense for both of us, great; if not, no hard feelings."',
      ctx.marketBand ? '"I pull recent sales nearby, so whatever I offer is grounded in real numbers."' : '"I\'ll do my homework on recent sales before we talk numbers."',
    ],
    doNotSay: [
      'Do not quote a price or comp number on a discovery call.',
      'Do not promise anything you can\'t verify.',
      'Do not claim certainty about acreage/zoning/flood until verified.',
      'Do not pressure or create false urgency.',
    ],
    desiredOutcome: na.action === 'prepare_offer_call'
      ? 'Lock in the decision-makers + their bottom-line range, and set the offer call.'
      : 'Establish motivation, timeline, price expectation, and decision-makers — and earn the next conversation.',
  };
}

export type FollowUpFormat = 'sms' | 'email' | 'call_script';
export interface FollowUpDraft { format: FollowUpFormat; draft: string; sent: false; note: string }

/** Generate a follow-up DRAFT only (never sent). Seller-context aware, plain
 *  voice, leverage-preserving, no unverified claims. */
export function buildFollowUpDraft(s: AcquisitionState, format: FollowUpFormat): FollowUpDraft {
  const p = s.profile;
  const name = p.name ? p.name.split(/[ ,]/)[0] : 'there';
  const ref = p.relationshipToProperty || 'your property';
  let draft: string;
  if (format === 'sms') {
    draft = `Hi ${name}, it's Tyler — following up on ${ref}. No rush on my end; just wanted to see where your head's at. Happy to work around your timeline. Want me to give you a quick call this week?`;
  } else if (format === 'email') {
    draft = `Subject: Following up on ${ref}\n\nHi ${name},\n\nGood talking with you. I wanted to circle back on ${ref}. I'm still interested and doing my homework on recent nearby sales so anything I bring you is grounded in real numbers.\n\nWhenever you're ready, I'm happy to talk next steps — no pressure either way. What works for you?\n\nThanks,\nTyler`;
  } else {
    draft = `CALL SCRIPT (follow-up):\n- Open: "Hey ${name}, it's Tyler — got a minute? Just following up on ${ref}."\n- Reconnect: reference last conversation${p.motivation ? ` (motivation: ${p.motivation})` : ''}.\n- Listen: "Where are you leaning since we last talked?"\n- Move: ${p.askingPrice ? 'confirm their number is still the same, then set the offer conversation.' : 'get a price range and confirm decision-makers.'}\n- Close: agree on a concrete next step + date. No pressure.`;
  }
  return { format, draft, sent: false, note: 'DRAFT ONLY — nothing was sent. Review/edit before any outreach.' };
}

// ── Acquisition playbook foundation (starter; editable; not "trained" yet) ──────
export interface AcquisitionPlaybook {
  status: 'foundational' | 'trained';
  toneRules: string[];
  phrasePreferences: string[];
  sellerFacingLanguageRules: string[];
  negotiationPosture: string[];
  discoveryCallGoals: string[];
  offerCallGoals: string[];
  objectionCategories: string[];
  followUpStyle: string[];
  doNotSay: string[];
  trainingSourceRefs: string[];
}

/** The v1 starter playbook. Labeled FOUNDATIONAL until training ingestion exists. */
export function acquisitionPlaybook(trainedSources: string[] = []): AcquisitionPlaybook {
  return {
    status: trainedSources.length > 0 ? 'trained' : 'foundational',
    toneRules: ['Plain-spoken, warm, unhurried.', 'Curious over persuasive — let the seller talk.', 'No pressure, no false urgency.', 'No fake certainty; never claim unverified facts.'],
    phrasePreferences: ['"If it makes sense for both of us…"', '"No hard feelings if the timing isn\'t right."', '"I\'ll do my homework before we talk numbers."'],
    sellerFacingLanguageRules: ['Label property facts the seller gives as their words, not confirmed.', 'Never quote a price/comp on discovery.', 'Preserve leverage — don\'t over-explain or over-justify.'],
    negotiationPosture: ['Anchor on real comps, not opinion.', 'Sell certainty + speed, not the highest price.', 'Be willing to walk; scarcity is leverage.'],
    discoveryCallGoals: ['Motivation', 'Timeline', 'Price expectation', 'Decision-makers', 'Condition/access seller-stated facts'],
    offerCallGoals: ['Confirm decision-makers present', 'Reconfirm range', 'Frame the offer against verified comps', 'Get a yes/no/counter — not "let me think"'],
    objectionCategories: ['Price ("worth more")', 'Trust ("who are you")', 'Timing ("not ready")', 'Process ("how does this work")', 'Decision ("need to talk to…")'],
    followUpStyle: ['Short, human, low-pressure.', 'One clear next step.', 'Reference their words, not a template.'],
    doNotSay: ['No pressure tactics.', 'No unverified claims about the parcel.', 'No price/comp numbers until offer prep.', 'No over-promising.'],
    trainingSourceRefs: trainedSources,
  };
}

// ── R2 training storage readiness (config/contract only — NOT the pipeline) ─────
// Canonical R2 base for acquisition training material (under landos-knowledge).
const ACQ_ROOT = 'agents/acquisitions';
export const ACQ_TRAINING_PATHS = {
  rawMp3: `${ACQ_ROOT}/training/raw/mp3/`,
  rawMp4: `${ACQ_ROOT}/training/raw/mp4/`,
  youtubeLinks: `${ACQ_ROOT}/training/raw/youtube_links/`,
  transcripts: `${ACQ_ROOT}/training/transcripts/`,
  summaries: `${ACQ_ROOT}/training/summaries/`,
  playbook: `${ACQ_ROOT}/playbook/`,
  callExamples: `${ACQ_ROOT}/call_examples/`,
} as const;

export interface AcquisitionTrainingReadiness {
  backend: 'r2' | 'local-fs';
  r2Configured: boolean;
  paths: typeof ACQ_TRAINING_PATHS;
  ingestionImplemented: false;
  note: string;
}

/** Presence-only readiness for acquisition training storage. Uses the existing
 *  KnowledgeStore abstraction (R2 when keyed, else local-fs). NO ingestion built. */
export function acquisitionTrainingReadiness(): AcquisitionTrainingReadiness {
  const st = knowledgeStoreStatus();
  return {
    backend: st.selected,
    r2Configured: st.selected === 'r2',
    paths: ACQ_TRAINING_PATHS,
    ingestionImplemented: false,
    note: st.selected === 'r2'
      ? 'R2-ready: training paths defined; MP3/MP4/YouTube/transcript ingestion is a future pipeline (not built). Raw media never enters Git.'
      : `Storage backend is "${st.selected}". Add R2 credentials to store acquisition training in R2; paths are defined and ready. Ingestion pipeline not built.`,
  };
}
