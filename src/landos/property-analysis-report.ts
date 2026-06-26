// LandOS — Property Analysis report output (Markdown + downloadable PDF).
//
// Both renders come from the SAME structured PropertyAnalysisResult the dashboard
// uses (single source of truth). Reports are LOCAL ONLY: written under the
// gitignored store/ dir, never into the repo. The PDF generator lazily loads
// pdfkit so the codebase compiles/tests without it; once `npm install pdfkit
// @types/pdfkit` is run it emits a real downloadable PDF, otherwise it returns an
// honest "dependency not installed" result (never a fake/stub file).

import fs from 'fs';
import path from 'path';
import type { PropertyAnalysisResult } from './property-analysis.js';
import type { StrategyScenario } from './offer-engine.js';
import { buildVisualPropertyContext, renderVisualContextMarkdown, googleVisualConfiguredResolved } from './providers/google-visual.js';

type StrategyScenarioLike = StrategyScenario;

function h(s: string): string { return `\n## ${s}\n`; }
function kv(k: string, v: unknown): string { return `- **${k}:** ${v ?? '—'}`; }

/** Render the full Markdown report. Includes every required section. Pure. */
export function toMarkdown(r: PropertyAnalysisResult): string {
  const L: string[] = [];
  L.push(`# Property Analysis — ${r.input || 'unknown input'}`);
  L.push('');
  L.push(`**${r.verified}** · **${r.verdict}** · **${r.offerReadiness}**`);
  L.push('');
  L.push(`Report timestamp: ${r.reportTimestamp}`);
  L.push(`Progress/terminal states: ${r.statuses.join(' → ')}`);

  L.push(h('Intake & Resolver'));
  L.push(kv('Original input', r.originalInput));
  L.push(kv('Resolver path', `${r.resolverPath} — ${r.resolverReason}`));
  if (r.correctionCandidates.length) {
    L.push('**Typo-correction candidates (capped, ranked):**');
    for (const c of r.correctionCandidates) {
      L.push(`- "${c.corrected}" — ${c.reason} (conf ${c.confidence.toFixed(2)})${c.validatedBySource ? ' · VALIDATED by named source' : ''}`);
    }
  }
  if (r.smallestNextIdentifier) L.push(kv('Smallest next identifier', r.smallestNextIdentifier));

  L.push(h('Parcel Verification'));
  L.push(kv('Status', r.parcelVerification.status));
  L.push(kv('Verified', r.parcelVerification.parcelVerified));
  L.push(kv('LandPortal API version', r.parcelVerification.lpApiVersion));
  L.push(kv('Verification source', r.parcelVerification.verificationSource));
  if (r.parcelVerification.identity) {
    const id = r.parcelVerification.identity;
    L.push(kv('APN', id.apn));
    L.push(kv('County/State', `${id.county ?? '—'} / ${id.state ?? '—'}`));
    L.push(kv('FIPS', id.fips));
    L.push(kv('Situs address', id.situsAddress));
    L.push(kv('Owner (source)', id.owner));
  }
  L.push(kv('Summary', r.parcelVerification.summary));
  if (r.parcelVerification.nextAction) L.push(kv('Next action', r.parcelVerification.nextAction));

  L.push(h('Property / DD Facts'));
  if (r.ddFacts) {
    L.push('```json');
    L.push(JSON.stringify(r.ddFacts, null, 2));
    L.push('```');
  } else {
    L.push('_No verified property facts (parcel not verified — Local Area Context only)._');
  }

  L.push(h('Data Gaps and Risk Flags'));
  L.push('**Data gaps:**');
  L.push(r.dataGaps.length ? r.dataGaps.map((g) => `- ${g}`).join('\n') : '- (none reported)');
  L.push('**Risk flags:**');
  L.push(r.riskFlags.length ? r.riskFlags.map((g) => `- ${g}`).join('\n') : '- (none reported)');

  L.push(h('Local Market Pulse'));
  L.push(kv('Area', r.marketPulse.localArea.descriptor));
  L.push(kv('Label', r.marketPulse.label));
  L.push(kv('Eligible', r.marketPulse.eligible));
  for (const s of r.marketPulse.signals) {
    L.push(`- **${s.signal}** — _${s.status}_${s.sourceName ? ` · ${s.sourceName}` : ''}: ${s.note}${s.sourceUrl ? ` (${s.sourceUrl})` : ''}`);
  }
  if (r.marketPulse.disclaimer) L.push(`\n> ${r.marketPulse.disclaimer}`);

  // Visual Property Context (Google) — supporting context only, never verification.
  // Built purely from the verified identity address; no Google call in this render.
  const vid = r.parcelVerification.identity;
  const visualCtx = buildVisualPropertyContext(
    { address: vid?.situsAddress ?? null, city: vid?.city ?? null, state: vid?.state ?? null },
    { configured: googleVisualConfiguredResolved(), now: () => r.reportTimestamp },
  );
  L.push('\n' + renderVisualContextMarkdown(visualCtx));

  L.push(h('Redfin Sold Comps'));
  L.push(kv('Lane started', `${r.redfinComps.ran} (from ${r.redfinComps.startedFrom}, concurrent with resolver: ${r.lanes.redfin.concurrentWithResolver})`));
  L.push(kv('Readiness', `${r.redfinComps.readiness.ready} — ${r.redfinComps.readiness.reason}`));
  L.push(kv('Live provider wired (compsLive)', r.redfinComps.compsLive));
  L.push(kv('Provider status', r.redfinComps.providerStatus ?? '—'));
  L.push(kv('Actual Apify call count', r.redfinComps.apifyCallCount));
  L.push(kv('Zero-comp classification', r.redfinComps.zeroCompClassification));
  if (r.redfinComps.provisional) L.push(kv('Provisional (area-level, NOT subject)', r.redfinComps.provisionalComps.length));
  if (r.redfinComps.waitingReason) L.push(kv('Waiting reason', r.redfinComps.waitingReason));
  if (r.redfinComps.terminalState) L.push(kv('Terminal state', r.redfinComps.terminalState));
  L.push(kv('Note', r.redfinComps.note));
  if (r.redfinComps.comps.length) {
    L.push('\n| Sold price | Sale date | Acres | $/acre | Source |');
    L.push('|---|---|---|---|---|');
    for (const c of r.redfinComps.comps) {
      L.push(`| $${c.price.toLocaleString()} | ${c.saleDateIso} | ${c.acres ?? '—'} | ${c.pricePerAcre ?? '—'} | ${c.sourceUrl} |`);
    }
  } else {
    L.push('_No usable sold comps returned._');
  }

  L.push(h('Comp Inclusion / Exclusion Notes'));
  L.push(r.compInclusionExclusionNotes.length ? r.compInclusionExclusionNotes.map((n) => `- ${n}`).join('\n') : '- (none)');

  L.push(h('Strategy Matrix'));
  if (r.strategyMatrix.length) {
    L.push('\n| Strategy | Feasible | Offer low | Offer high | Output | Notes |');
    L.push('|---|---|---|---|---|---|');
    for (const s of r.strategyMatrix as StrategyScenarioLike[]) {
      L.push(`| ${s.label} | ${s.feasible} | ${s.offerLowUsd ?? '—'} | ${s.offerHighUsd ?? '—'} | ${s.outputLabel} | ${(s.reasons[0] ?? '').replace(/\|/g, '/')} |`);
    }
  } else {
    L.push('_Strategy matrix blocked: insufficient verified evidence._');
  }

  L.push(h('Underwriting / Offer Readiness'));
  L.push(kv('Expected Value', r.underwriting.expectedValueUsd != null ? `$${r.underwriting.expectedValueUsd.toLocaleString()}` : 'not ready'));
  L.push(kv('EV basis', r.underwriting.evBasis));
  L.push(kv('Offer readiness', r.underwriting.offerReadiness));
  if (r.underwriting.blockerNote) L.push(kv('Blocker', r.underwriting.blockerNote));

  L.push(h('Most Viable Strategy'));
  L.push(r.mostViableStrategy ? `**${r.mostViableStrategy.label}** — ${r.mostViableStrategy.reason}` : '_None: no feasible lane with sufficient evidence._');

  L.push(h('Discovery Questions'));
  L.push(r.discoveryQuestions.length ? r.discoveryQuestions.map((q) => `- ${q}`).join('\n') : '- (none)');

  L.push(h('Source Table'));
  L.push('\n| Category | Source | Status | Confidence | Timestamp | Note |');
  L.push('|---|---|---|---|---|---|');
  for (const s of r.sourceTable) {
    L.push(`| ${s.category} | ${s.source} | ${s.status} | ${s.confidence} | ${s.timestamp} | ${String(s.note).replace(/\|/g, '/')} |`);
  }

  L.push(h('Provider Calls'));
  if (r.providerCalls.length) {
    for (const c of r.providerCalls) L.push(`- ${c.source} · ${c.kind} · ${c.rows} row(s) · $${c.spendUsd.toFixed(2)}`);
  } else {
    L.push('- (no provider calls made)');
  }
  L.push(kv('Total provider calls', r.providerCallCount));

  L.push(h('Actual Spend'));
  L.push(kv('Actual logged spend', `$${r.actualSpendUsd.toFixed(2)}`));

  L.push('');
  return L.join('\n');
}

function slug(s: string): string {
  return (s || 'property').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'property';
}

export interface SaveReportResult {
  markdownPath: string;
  pdfPath: string | null;
  pdfReason: string;
}

/**
 * Persist the report locally (gitignored store/). Markdown always. PDF via lazy
 * pdfkit — a real downloadable PDF when the dependency is installed, otherwise an
 * honest reason (never a fake file). `writeFile`/`pdfDir` injectable for tests.
 */
export async function savePropertyAnalysisReport(
  r: PropertyAnalysisResult,
  opts: { baseDir?: string } = {},
): Promise<SaveReportResult> {
  const baseDir = opts.baseDir ?? path.join(process.cwd(), 'store', 'landos-reports');
  fs.mkdirSync(baseDir, { recursive: true });
  const stamp = r.reportTimestamp.replace(/[:.]/g, '-');
  const base = `${slug(r.input)}_${stamp}`;
  const markdownPath = path.join(baseDir, `${base}.md`);
  fs.writeFileSync(markdownPath, toMarkdown(r), 'utf-8');

  let pdfPath: string | null = null;
  let pdfReason = '';
  try {
    pdfPath = await writePdf(r, path.join(baseDir, `${base}.pdf`));
    pdfReason = 'PDF generated via pdfkit.';
  } catch (err) {
    pdfPath = null;
    pdfReason = `PDF not generated: ${(err as Error)?.message ?? 'pdfkit unavailable'}. Run: npm install pdfkit @types/pdfkit`;
  }
  return { markdownPath, pdfPath, pdfReason };
}

/** Generate a real PDF using lazily-loaded pdfkit. Throws if pdfkit is missing
 *  (caller converts to an honest reason). Never writes a placeholder file. */
async function writePdf(r: PropertyAnalysisResult, outPath: string): Promise<string> {
  // Lazy import so the build/tests do not require pdfkit to be installed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('pdfkit' as string).catch(() => { throw new Error('pdfkit not installed'); });
  const PDFDocument = mod.default ?? mod;
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
    const stream = fs.createWriteStream(outPath);
    stream.on('finish', () => resolve());
    stream.on('error', reject);
    doc.pipe(stream);

    const title = (t: string) => doc.moveDown(0.6).fontSize(13).fillColor('#111').text(t).moveDown(0.2).fontSize(9).fillColor('#333');
    const line = (t: string) => doc.fontSize(9).fillColor('#333').text(t);

    doc.fontSize(18).fillColor('#000').text(`Property Analysis — ${r.input || 'unknown'}`);
    doc.fontSize(11).fillColor('#444').text(`${r.verified} · ${r.verdict} · ${r.offerReadiness}`);
    line(`Report timestamp: ${r.reportTimestamp}`);

    title('Parcel Verification');
    line(`Status: ${r.parcelVerification.status} | Verified: ${r.parcelVerification.parcelVerified} | LP ${r.parcelVerification.lpApiVersion}`);
    if (r.parcelVerification.identity) {
      const id = r.parcelVerification.identity;
      line(`APN ${id.apn ?? '—'} | ${id.county ?? '—'}/${id.state ?? '—'} | FIPS ${id.fips ?? '—'} | ${id.situsAddress ?? '—'}`);
    }
    line(r.parcelVerification.summary);

    title('Property / DD Facts');
    line(r.ddFacts ? JSON.stringify(r.ddFacts) : 'No verified property facts (Local Area Context only).');

    title('Data Gaps & Risk Flags');
    line(`Gaps: ${r.dataGaps.join(', ') || '(none)'}`);
    line(`Risks: ${r.riskFlags.join(', ') || '(none)'}`);

    title('Local Market Pulse');
    line(`${r.marketPulse.localArea.descriptor} — ${r.marketPulse.label}`);
    for (const s of r.marketPulse.signals) line(`• ${s.signal} [${s.status}] ${s.note}`);

    title('Redfin Sold Comps');
    line(`Ran: ${r.redfinComps.ran} | Readiness: ${r.redfinComps.readiness.ready} (${r.redfinComps.readiness.reason})`);
    if (r.redfinComps.comps.length) for (const c of r.redfinComps.comps) line(`• $${c.price.toLocaleString()} ${c.saleDateIso} ${c.acres ?? '—'}ac ${c.sourceUrl}`);
    else line('No usable sold comps returned.');

    title('Comp Inclusion / Exclusion Notes');
    for (const n of r.compInclusionExclusionNotes) line(`• ${n}`);

    title('Strategy Matrix');
    for (const s of r.strategyMatrix as StrategyScenarioLike[]) line(`• ${s.label}: feasible ${s.feasible} | ${s.offerLowUsd ?? '—'}-${s.offerHighUsd ?? '—'} | ${s.outputLabel}`);
    if (!r.strategyMatrix.length) line('Strategy blocked: insufficient verified evidence.');

    title('Underwriting / Offer Readiness');
    line(`EV: ${r.underwriting.expectedValueUsd != null ? '$' + r.underwriting.expectedValueUsd.toLocaleString() : 'not ready'} (${r.underwriting.evBasis})`);
    line(`Offer readiness: ${r.underwriting.offerReadiness}${r.underwriting.blockerNote ? ' — ' + r.underwriting.blockerNote : ''}`);

    title('Most Viable Strategy');
    line(r.mostViableStrategy ? `${r.mostViableStrategy.label} — ${r.mostViableStrategy.reason}` : 'None.');

    title('Discovery Questions');
    for (const q of r.discoveryQuestions) line(`• ${q}`);

    title('Source Table');
    for (const s of r.sourceTable) line(`• [${s.category}] ${s.source} — ${s.status}/${s.confidence} (${s.timestamp})`);

    title('Provider Calls & Spend');
    for (const c of r.providerCalls) line(`• ${c.source} ${c.kind} ${c.rows} rows $${c.spendUsd.toFixed(2)}`);
    line(`Total calls: ${r.providerCallCount} | Actual spend: $${r.actualSpendUsd.toFixed(2)}`);

    doc.end();
  });
  return outPath;
}
