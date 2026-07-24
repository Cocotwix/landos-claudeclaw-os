import { createHash } from 'node:crypto';
import { getLandosDb, landosAudit, type LandosEntity } from './db.js';
import type {
  SmartIntakeImageExtraction,
  SmartIntakeImageMimeType,
  SmartIntakeImageSourceMethod,
} from './smart-intake-image.js';

export const INTAKE_SECTIONS = [
  'seller_contact', 'motivation_timeline', 'property', 'due_diligence',
  'public_record', 'deed_title_easement', 'lien_judgment_tax',
  'planning_zoning_subdivision', 'utilities_septic_access', 'market',
  'strategy', 'resource_contact', 'document', 'activity',
] as const;
export type IntakeSection = (typeof INTAKE_SECTIONS)[number];

export const RESOURCE_CATEGORIES = [
  'planning_zoning', 'assessor_gis', 'clerk_recorder', 'tax_office',
  'health_department', 'roads_bridges', 'utility', 'surveyor',
  'soil_scientist', 'septic_professional', 'excavation_site_work',
  'manufactured_home', 'other',
] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export interface RoutedFact {
  section: IntakeSection;
  key: string;
  value: string;
  status: 'candidate' | 'stated' | 'observed' | 'verified';
}

export interface IntakeImageArtifactInput {
  documentUploadId: number;
  originalFileName: string;
  fileUrl: string;
  mimeType: SmartIntakeImageMimeType;
  byteSize: number;
  sha256: string;
  sourceMethod: SmartIntakeImageSourceMethod;
  extraction: SmartIntakeImageExtraction;
}

export interface TranscriptExtraction {
  person: string | null;
  department: string | null;
  organization: string | null;
  phone: string | null;
  email: string | null;
  callDate: string | null;
  propertyDiscussed: string | null;
  importantStatements: string[];
  confirmedFacts: string[];
  contactStatedFacts: string[];
  sellerMotivation: string | null;
  timeline: string | null;
  askingPrice: number | null;
  objections: string[];
  restrictions: string[];
  unresolvedQuestions: string[];
  followUps: string[];
}

export interface IntakeAnalysis {
  summary: string;
  sections: IntakeSection[];
  facts: RoutedFact[];
  transcript: TranscriptExtraction | null;
  resourceContacts: ResourceContactInput[];
  followUps: string[];
}

export type IntakeModelAnalyzer = (prompt: string) => Promise<unknown>;

function clean(value: unknown, max = 2_000): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
function capture(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1], 300);
  }
  return null;
}
function dollars(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function sectionRules(text: string): IntakeSection[] {
  const rules: Array<[IntakeSection, RegExp]> = [
    ['seller_contact', /seller|owner|phone|email|contact|spoke with|called/i],
    ['motivation_timeline', /motivat|timeline|sell because|close by|within \d+ (?:day|week|month)|asking price/i],
    ['property', /\bparcel\b|\bapn\b|acre|address|terrain|slope|wetland|flood/i],
    ['due_diligence', /due diligence|confirm|verify|unresolved|inspection|restriction/i],
    ['public_record', /assessor|gis|public record|official record|trustee|county record/i],
    ['deed_title_easement', /\bdeed\b|title|easement|grantor|grantee|instrument|book\s*\/\s*page|covenant|reservation/i],
    ['lien_judgment_tax', /\blien\b|judg(?:e)?ment|delinquent|tax(?:es)?|amount owed|creditor/i],
    ['planning_zoning_subdivision', /planning|zoning|subdiv|minor split|lot size|frontage|manufactured home|mobile home/i],
    ['utilities_septic_access', /utility|electric|water|sewer|septic|perc|driveway|road|access/i],
    ['market', /comparable|\bcomp\b|market|sold|listing|price per acre/i],
    ['strategy', /strategy|quick flip|novation|double close|land-home|improvement then flip/i],
    ['resource_contact', /department|office|contractor|surveyor|soil scientist|engineer|representative/i],
    ['document', /document|pdf|screenshot|transcript|attachment|recording/i],
  ];
  const sections = rules.filter(([, pattern]) => pattern.test(text)).map(([section]) => section);
  sections.push('activity');
  return unique(sections);
}

function firstUsefulSummary(text: string, isTranscript: boolean): string {
  const compact = clean(text, 800);
  const first = compact.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  const summary = first.length > 300 ? `${first.slice(0, 297)}...` : first;
  return `${isTranscript ? 'Transcript saved' : 'Information saved'}${summary ? `: ${summary}` : '.'}`;
}

function deterministicTranscript(text: string): TranscriptExtraction {
  const allLines = lines(text);
  const person = capture(text, [
    /^(?:spoke|talked|called|contact(?:ed)?)\s+(?:with\s+)?([^\r\n,;]+)/im,
    /(?:person|representative|contact)\s*[:\-]\s*([^\n,;]+)/i,
  ]);
  const organization = capture(text, [/(?:organization|company|office)\s*[:\-]\s*([^\n;]+)/i, /([A-Z][\w &'-]+(?:County|City|Department|Office|Utilities|Company))/]);
  const department = capture(text, [/(?:department|dept)\s*[:\-]\s*([^\n;]+)/i, /((?:Planning|Zoning|Assessor|GIS|Register of Deeds|Health|Roads?|Utilities?)\s+(?:Department|Office))/i]);
  const phone = capture(text, [/(\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/]);
  const email = capture(text, [/([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/]);
  const callDate = capture(text, [/(?:call date|date)\s*[:\-]\s*([A-Za-z0-9,\-/ ]{6,30})/i]);
  const propertyDiscussed = capture(text, [/(?:property|parcel|address)\s*(?:discussed)?\s*[:\-]\s*([^\n;]+)/i]);
  const sellerMotivation = capture(text, [/(?:motivation|selling because|wants to sell because)\s*[:\-]?\s*([^\n.;]+)/i]);
  const timeline = capture(text, [/(?:timeline|close by|closing by)\s*[:\-]\s*([^\n.;]+)/i, /(within\s+\d+\s+(?:days?|weeks?|months?))/i]);
  const askingPrice = dollars(capture(text, [/(?:asking(?: price)?|price)\s*[:\-]?\s*(\$?[\d,]+(?:\.\d{2})?)/i]));
  const byPrefix = (prefix: RegExp) => allLines
    .filter((line) => prefix.test(line))
    .map((line) => clean(line.replace(prefix, ''), 500))
    .filter(Boolean);
  const questions = allLines
    .filter((line) => line.endsWith('?'))
    .map((line) => clean(line.replace(/^(?:unresolved|question)\s*[:\-]\s*/i, ''), 500));
  return {
    person, department, organization, phone, email, callDate, propertyDiscussed,
    importantStatements: byPrefix(/^(?:statement|important|said|noted)\s*[:\-]\s*/i),
    confirmedFacts: byPrefix(/^(?:confirmed|officially confirmed|verified)\s*[:\-]\s*/i),
    contactStatedFacts: byPrefix(/^(?:contact stated|seller stated|stated)\s*[:\-]\s*/i),
    sellerMotivation, timeline, askingPrice,
    objections: byPrefix(/^(?:objection|concern)\s*[:\-]\s*/i),
    restrictions: byPrefix(/^(?:restriction|restricted)\s*[:\-]\s*/i),
    unresolvedQuestions: unique([...byPrefix(/^(?:unresolved|question)\s*[:\-]\s*/i), ...questions]),
    followUps: byPrefix(/^(?:follow[ -]?up|next step|action)\s*[:\-]\s*/i),
  };
}

function deterministicFacts(text: string, sections: IntakeSection[], transcript: TranscriptExtraction | null): RoutedFact[] {
  const facts: RoutedFact[] = [];
  const add = (section: IntakeSection, key: string, value: string | null, status: RoutedFact['status'] = 'stated') => {
    if (value) facts.push({ section, key, value: clean(value, 1000), status });
  };
  add('property', 'apn', capture(text, [/(?:APN|parcel id|parcel number)\s*[:#-]?\s*([\d A-Za-z.-]{4,40})/i]));
  add('property', 'acreage', capture(text, [/(\d+(?:\.\d+)?)\s*(?:acres?|ac\b)/i]));
  add('seller_contact', 'phone', transcript?.phone ?? capture(text, [/(\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/]));
  add('seller_contact', 'email', transcript?.email ?? capture(text, [/([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/]));
  add('motivation_timeline', 'motivation', transcript?.sellerMotivation ?? null);
  add('motivation_timeline', 'timeline', transcript?.timeline ?? null);
  if (transcript?.askingPrice != null) add('motivation_timeline', 'asking_price', String(transcript.askingPrice));
  for (const value of transcript?.confirmedFacts ?? []) add('due_diligence', 'confirmed_fact', value, 'observed');
  for (const value of transcript?.contactStatedFacts ?? []) add('due_diligence', 'contact_stated_fact', value, 'stated');
  for (const section of sections) {
    if (facts.some((fact) => fact.section === section)) continue;
    const matching = lines(text).find((line) => {
      if (section === 'deed_title_easement') return /deed|title|easement|restriction/i.test(line);
      if (section === 'lien_judgment_tax') return /lien|judgment|tax/i.test(line);
      if (section === 'planning_zoning_subdivision') return /planning|zoning|subdiv|manufactured|mobile home/i.test(line);
      if (section === 'utilities_septic_access') return /utility|septic|water|electric|road|access/i.test(line);
      return false;
    });
    add(section, 'statement', matching ?? null);
  }
  return facts;
}

function deterministicResource(text: string, transcript: TranscriptExtraction | null): ResourceContactInput[] {
  const organization = transcript?.organization ?? capture(text, [/(?:organization|company|office)\s*[:\-]\s*([^\n;]+)/i]);
  const department = transcript?.department ?? capture(text, [/(?:department|dept)\s*[:\-]\s*([^\n;]+)/i]);
  if (!organization && !department) return [];
  return [{
    dealCardId: 0,
    category: resourceCategory(`${organization ?? ''} ${department ?? ''}`),
    organization: organization ?? '', department: department ?? '', representative: transcript?.person ?? '',
    role: '', phone: transcript?.phone ?? '', email: transcript?.email ?? '', website: '', address: '',
    jurisdiction: '', notes: '', source: 'smart intake', lastContactedDate: transcript?.callDate ?? '',
    linkedItems: [], nextFollowUp: transcript?.followUps?.[0] ?? '',
  }];
}

function resourceCategory(text: string): ResourceCategory {
  if (/planning|zoning/i.test(text)) return 'planning_zoning';
  if (/assessor|gis/i.test(text)) return 'assessor_gis';
  if (/recorder|register of deeds|clerk/i.test(text)) return 'clerk_recorder';
  if (/tax|trustee/i.test(text)) return 'tax_office';
  if (/health/i.test(text)) return 'health_department';
  if (/road|bridge/i.test(text)) return 'roads_bridges';
  if (/utility|water|electric|sewer/i.test(text)) return 'utility';
  if (/survey/i.test(text)) return 'surveyor';
  if (/soil/i.test(text)) return 'soil_scientist';
  if (/septic|perc/i.test(text)) return 'septic_professional';
  if (/excavat|gravel|driveway|clearing|site work/i.test(text)) return 'excavation_site_work';
  if (/manufactured|mobile home/i.test(text)) return 'manufactured_home';
  return 'other';
}

function safeModelAnalysis(value: unknown): Partial<IntakeAnalysis> | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const sections = Array.isArray(raw.sections)
    ? raw.sections.filter((s): s is IntakeSection => typeof s === 'string' && (INTAKE_SECTIONS as readonly string[]).includes(s))
    : [];
  const facts = Array.isArray(raw.facts) ? raw.facts.flatMap((item): RoutedFact[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const section = typeof row.section === 'string' && (INTAKE_SECTIONS as readonly string[]).includes(row.section) ? row.section as IntakeSection : null;
    const key = clean(row.key, 100); const value = clean(row.value, 1000);
    const status = row.status === 'verified' || row.status === 'observed' ? row.status : 'stated';
    return section && key && value ? [{ section, key, value, status }] : [];
  }) : [];
  return { summary: clean(raw.summary, 300), sections, facts };
}

export async function analyzeLeadCardIntake(input: {
  text: string;
  submissionType?: 'general' | 'transcript';
  modelAnalyzer?: IntakeModelAnalyzer;
}): Promise<IntakeAnalysis> {
  const text = input.text.trim();
  if (!text) throw new Error('Paste information or choose a supported file.');
  const isTranscript = input.submissionType === 'transcript' || /\b(transcript|call date|speaker|spoke with|called)\b/i.test(text);
  const transcript = isTranscript ? deterministicTranscript(text) : null;
  const deterministicSections = sectionRules(text);
  if (isTranscript) deterministicSections.push('document');
  let model: Partial<IntakeAnalysis> | null = null;
  if (input.modelAnalyzer) {
    const prompt = `Organize this Deal Card submission into concise operator-facing records. Return JSON only with summary (max 2 sentences), sections from ${INTAKE_SECTIONS.join(', ')}, and facts [{section,key,value,status}]. Seller/contact statements must use status stated. Never make legal conclusions or turn a missing search result into a no-liens/no-restrictions claim.\n\nSUBMISSION:\n${text.slice(0, 20_000)}`;
    try { model = safeModelAnalysis(await input.modelAnalyzer(prompt)); } catch { model = null; }
  }
  const facts = [...deterministicFacts(text, deterministicSections, transcript), ...(model?.facts ?? [])];
  const dedupedFacts = [...new Map(facts.map((fact) => [`${fact.section}|${fact.key}|${fact.value}`.toLowerCase(), fact])).values()];
  const sections = unique<IntakeSection>([...deterministicSections, ...(model?.sections ?? []), ...dedupedFacts.map((fact) => fact.section), 'activity']);
  const lineFollowUps = lines(text)
    .filter((line) => /^(?:follow[ -]?up|next step|action)\s*[:\-]\s*/i.test(line))
    .map((line) => clean(line.replace(/^(?:follow[ -]?up|next step|action)\s*[:\-]\s*/i, ''), 500))
    .filter(Boolean);
  const inlineFollowUps = [...text.matchAll(/\b(?:follow[ -]?up|next step|action)\s*[:\-]\s*([^\r\n.]+\.?)/ig)]
    .map((match) => clean(match[1], 500))
    .filter(Boolean);
  const generalFollowUps = unique([...lineFollowUps, ...inlineFollowUps]);
  const followUps = unique([...(transcript?.followUps ?? generalFollowUps), ...(transcript?.unresolvedQuestions ?? []).map((q) => `Resolve: ${q}`)]);
  return {
    summary: model?.summary || firstUsefulSummary(text, isTranscript),
    sections,
    facts: dedupedFacts,
    transcript,
    resourceContacts: deterministicResource(text, transcript),
    followUps,
  };
}

export function personAliasKey(name: string): string {
  return name.normalize('NFKD').replace(/[^a-zA-Z0-9 ]/g, ' ').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

export function namesReconcile(left: string, right: string): boolean {
  const a = personAliasKey(left).split(' ').filter(Boolean);
  const b = personAliasKey(right).split(' ').filter(Boolean);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  return a.length === 2 && b.length === 2 && a[0] === b[1] && a[1] === b[0];
}

export function ownerFacingPersonName(rawName: string | null | undefined, dealCardId?: number): string {
  const raw = clean(rawName, 300);
  if (!raw) return raw;
  const key = personAliasKey(raw);
  const db = getLandosDb();
  const row = dealCardId == null
    ? db.prepare(`SELECT p.name FROM landos_person_alias a JOIN landos_person p ON p.id=a.person_id WHERE a.alias_key=? ORDER BY a.id LIMIT 1`).get(key) as { name: string } | undefined
    : db.prepare(`SELECT p.name FROM landos_person_alias a JOIN landos_person p ON p.id=a.person_id JOIN landos_person_link l ON l.person_id=p.id WHERE a.alias_key=? AND l.deal_card_id=? ORDER BY a.id LIMIT 1`).get(key, dealCardId) as { name: string } | undefined;
  return row?.name || raw;
}

function insertAlias(personId: number, aliasName: string, source: string, official: boolean): void {
  const name = clean(aliasName, 300);
  if (!name) return;
  getLandosDb().prepare(`INSERT INTO landos_person_alias (person_id,alias_name,alias_key,source,official_format) VALUES (?,?,?,?,?) ON CONFLICT(person_id,alias_key) DO UPDATE SET source=excluded.source, official_format=MAX(official_format,excluded.official_format)`).run(personId, name, personAliasKey(name), source, official ? 1 : 0);
}

function refreshOpportunityIdentityProjection(dealCardId: number, canonicalName: string, aliases: string[], actor: string): void {
  const db = getLandosDb();
  const rows = db.prepare(`SELECT p.opportunity_id,p.package_json
    FROM landos_opportunity_discovery_package p
    JOIN landos_opportunity o ON o.id=p.opportunity_id
    WHERE o.legacy_deal_card_id=?`).all(dealCardId) as Array<{ opportunity_id: number; package_json: string }>;
  const aliasKeys = new Set(aliases.map(personAliasKey));
  for (const row of rows) {
    try {
      const pkg = JSON.parse(row.package_json) as Record<string, unknown>;
      const identity = pkg.identity && typeof pkg.identity === 'object' ? pkg.identity as Record<string, unknown> : null;
      if (!identity) continue;
      if (Array.isArray(identity.contacts)) {
        identity.contacts = identity.contacts.map((contact) => {
          if (!contact || typeof contact !== 'object') return contact;
          const current = contact as Record<string, unknown>;
          const name = clean(current.name, 300);
          return aliasKeys.has(personAliasKey(name)) ? { ...current, name: canonicalName } : current;
        });
      }
      if (Array.isArray(identity.apparentRecordOwners)) {
        identity.apparentRecordOwners = identity.apparentRecordOwners.map((owner) => {
          const name = clean(owner, 300);
          return aliasKeys.has(personAliasKey(name)) ? canonicalName : owner;
        });
      }
      const withoutHash = { ...pkg };
      delete withoutHash.contentHash;
      const contentHash = createHash('sha256').update(JSON.stringify(withoutHash)).digest('hex');
      pkg.contentHash = contentHash;
      db.prepare(`UPDATE landos_opportunity_discovery_package
        SET content_hash=?,package_json=?,source_updated_at=strftime('%s','now'),generated_at=strftime('%s','now'),updated_by=?
        WHERE opportunity_id=?`).run(contentHash, JSON.stringify(pkg), actor, row.opportunity_id);
    } catch {
      // A malformed legacy package remains untouched; canonical person and
      // property records still carry the correction without erasing history.
    }
  }
}

export function reconcileDealPersonIdentity(input: {
  dealCardId: number;
  canonicalName: string;
  officialName: string;
  knownIncorrectNames?: string[];
  actor?: string;
}): { personId: number; canonicalName: string; officialName: string; aliases: string[] } {
  const db = getLandosDb();
  const deal = db.prepare('SELECT id,entity FROM landos_deal_card WHERE id=?').get(input.dealCardId) as { id: number; entity: LandosEntity } | undefined;
  if (!deal) throw new Error('deal card not found');
  const canonicalName = clean(input.canonicalName, 300);
  const officialName = clean(input.officialName, 300);
  if (!canonicalName || !officialName) throw new Error('canonical and official names are required');
  const aliases = unique([officialName, ...(input.knownIncorrectNames ?? []).map((name) => clean(name, 300)).filter(Boolean)]);
  const people = db.prepare(`SELECT p.* FROM landos_person_link l JOIN landos_person p ON p.id=l.person_id WHERE l.deal_card_id=? ORDER BY l.id`).all(input.dealCardId) as Array<{ id: number; name: string; phone: string; email: string }>;
  let person = people.find((row) => namesReconcile(row.name, canonicalName) || aliases.some((alias) => namesReconcile(row.name, alias)));
  if (!person && people.length === 1) person = people[0];
  let personId: number;
  if (person) {
    personId = person.id;
    insertAlias(personId, person.name, 'prior contact record', false);
    db.prepare(`UPDATE landos_person SET name=?, updated_at=strftime('%s','now') WHERE id=?`).run(canonicalName, personId);
  } else {
    personId = Number(db.prepare(`INSERT INTO landos_person (entity,name) VALUES (?,?)`).run(deal.entity, canonicalName).lastInsertRowid);
  }
  insertAlias(personId, canonicalName, 'canonical owner-facing identity', false);
  insertAlias(personId, officialName, 'official record formatting', true);
  for (const alias of aliases) insertAlias(personId, alias, alias === officialName ? 'official record formatting' : 'corrected prior intake', alias === officialName);
  for (const role of ['lead_contact', 'record_owner']) {
    const linked = db.prepare(`SELECT id FROM landos_person_link WHERE person_id=? AND deal_card_id=? AND role=?`).get(personId, input.dealCardId, role);
    if (!linked) db.prepare(`INSERT INTO landos_person_link (person_id,deal_card_id,role,authority_status,authority_source,note) VALUES (?,?,?,'unknown','','Identity reconciled; role does not imply signing authority.')`).run(personId, input.dealCardId, role);
  }
  const cards = db.prepare(`SELECT pc.id,pc.owner FROM landos_deal_card_property l JOIN landos_property_card pc ON pc.id=l.card_id WHERE l.deal_card_id=?`).all(input.dealCardId) as Array<{ id: number; owner: string }>;
  for (const card of cards) {
    if (namesReconcile(card.owner, officialName) || aliases.some((alias) => namesReconcile(card.owner, alias))) {
      db.prepare(`UPDATE landos_property_card SET owner=?, updated_at=strftime('%s','now') WHERE id=?`).run(canonicalName, card.id);
      db.prepare(`INSERT INTO landos_card_activity (card_id,agent_id,kind,summary,ref) VALUES (?,?,'identity_reconciled',?,?)`).run(card.id, input.actor ?? 'owner', `${canonicalName} is the lead/contact and owner of record. Official formatting ${officialName} is retained as source provenance; prior intake history was preserved.`, officialName);
    }
  }
  refreshOpportunityIdentityProjection(input.dealCardId, canonicalName, unique([canonicalName, ...aliases]), input.actor ?? 'owner');
  landosAudit(input.actor ?? 'owner', 'person_identity_reconciled', `deal ${input.dealCardId}: ${canonicalName}; official ${officialName}`, { entity: deal.entity, refTable: 'landos_person', refId: personId });
  return { personId, canonicalName, officialName, aliases: unique([canonicalName, ...aliases]) };
}

export interface ResourceContactInput {
  dealCardId: number;
  category: ResourceCategory;
  organization?: string;
  department?: string;
  representative?: string;
  role?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  jurisdiction?: string;
  notes?: string;
  source?: string;
  lastContactedDate?: string;
  linkedItems?: string[];
  nextFollowUp?: string;
}

function contactDedupeKey(input: ResourceContactInput): string {
  const parts = [input.category, input.organization, input.department, input.representative].map((value) => clean(value, 300).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  return parts.join('|');
}

export function upsertResourceContact(input: ResourceContactInput): Record<string, unknown> {
  const db = getLandosDb();
  if (!(RESOURCE_CATEGORIES as readonly string[]).includes(input.category)) throw new Error('invalid resource category');
  if (!clean(input.organization) && !clean(input.department)) throw new Error('organization or department is required');
  const key = contactDedupeKey(input);
  db.prepare(`INSERT INTO landos_resource_contact
    (deal_card_id,category,organization,department,representative,role,phone,email,website,address,jurisdiction,notes,source,last_contacted_date,linked_items_json,next_follow_up,dedupe_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(deal_card_id,dedupe_key) DO UPDATE SET
      role=CASE WHEN excluded.role<>'' THEN excluded.role ELSE role END,
      phone=CASE WHEN excluded.phone<>'' THEN excluded.phone ELSE phone END,
      email=CASE WHEN excluded.email<>'' THEN excluded.email ELSE email END,
      website=CASE WHEN excluded.website<>'' THEN excluded.website ELSE website END,
      address=CASE WHEN excluded.address<>'' THEN excluded.address ELSE address END,
      jurisdiction=CASE WHEN excluded.jurisdiction<>'' THEN excluded.jurisdiction ELSE jurisdiction END,
      notes=CASE WHEN excluded.notes<>'' THEN excluded.notes ELSE notes END,
      source=CASE WHEN excluded.source<>'' THEN excluded.source ELSE source END,
      last_contacted_date=CASE WHEN excluded.last_contacted_date<>'' THEN excluded.last_contacted_date ELSE last_contacted_date END,
      linked_items_json=CASE WHEN excluded.linked_items_json<>'[]' THEN excluded.linked_items_json ELSE linked_items_json END,
      next_follow_up=CASE WHEN excluded.next_follow_up<>'' THEN excluded.next_follow_up ELSE next_follow_up END,
      updated_at=strftime('%s','now')`).run(
      input.dealCardId, input.category, clean(input.organization), clean(input.department), clean(input.representative), clean(input.role), clean(input.phone), clean(input.email), clean(input.website), clean(input.address), clean(input.jurisdiction), clean(input.notes, 4000), clean(input.source), clean(input.lastContactedDate), JSON.stringify(input.linkedItems ?? []), clean(input.nextFollowUp, 1000), key,
    );
  const row = db.prepare(`SELECT * FROM landos_resource_contact WHERE deal_card_id=? AND dedupe_key=?`).get(input.dealCardId, key) as Record<string, unknown>;
  return { ...row, linkedItems: JSON.parse(String(row.linked_items_json ?? '[]')) };
}

export function listResourceContacts(dealCardId: number): Array<Record<string, unknown>> {
  return (getLandosDb().prepare(`SELECT * FROM landos_resource_contact WHERE deal_card_id=? ORDER BY category,organization,department,representative,id`).all(dealCardId) as Array<Record<string, unknown>>).map((row) => ({ ...row, linkedItems: JSON.parse(String(row.linked_items_json ?? '[]')) }));
}

export interface PublicRecordOutcomeInput {
  dealCardId: number;
  category: string;
  title: string;
  jurisdiction: string;
  authority: string;
  retrievalStatus: 'retrieved_yes' | 'retrieved_no' | 'no_matching_record';
  summary: string;
  facts?: Record<string, unknown>;
  sourceUrl?: string;
  screenshotUrl?: string;
  documentUrl?: string;
  searchedAt?: string;
  nextFollowUp?: string;
}

export function upsertPublicRecordOutcome(input: PublicRecordOutcomeInput): Record<string, unknown> {
  if (!input.category || !input.authority || !input.summary) throw new Error('category, authority, and summary are required');
  if (!['retrieved_yes', 'retrieved_no', 'no_matching_record'].includes(input.retrievalStatus)) throw new Error('invalid public-record retrieval status');
  const db = getLandosDb();
  db.prepare(`INSERT INTO landos_public_record_outcome
    (deal_card_id,category,title,jurisdiction,authority,retrieval_status,summary,facts_json,source_url,screenshot_url,document_url,searched_at,next_follow_up)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(deal_card_id,category,authority) DO UPDATE SET title=excluded.title,jurisdiction=excluded.jurisdiction,retrieval_status=excluded.retrieval_status,summary=excluded.summary,facts_json=excluded.facts_json,source_url=excluded.source_url,screenshot_url=excluded.screenshot_url,document_url=excluded.document_url,searched_at=excluded.searched_at,next_follow_up=excluded.next_follow_up,updated_at=strftime('%s','now')`).run(
      input.dealCardId, clean(input.category), clean(input.title), clean(input.jurisdiction), clean(input.authority), input.retrievalStatus, clean(input.summary, 5000), JSON.stringify(input.facts ?? {}), clean(input.sourceUrl, 2000), clean(input.screenshotUrl, 2000), clean(input.documentUrl, 2000), clean(input.searchedAt) || new Date().toISOString(), clean(input.nextFollowUp, 2000),
    );
  return readPublicRecordRow(input.dealCardId, input.category, input.authority)!;
}

function readPublicRecordRow(dealCardId: number, category: string, authority: string): Record<string, unknown> | undefined {
  const row = getLandosDb().prepare(`SELECT * FROM landos_public_record_outcome WHERE deal_card_id=? AND category=? AND authority=?`).get(dealCardId, category, authority) as Record<string, unknown> | undefined;
  return row ? { ...row, facts: JSON.parse(String(row.facts_json ?? '{}')) } : undefined;
}

export function listPublicRecordOutcomes(dealCardId: number): Array<Record<string, unknown>> {
  return (getLandosDb().prepare(`SELECT * FROM landos_public_record_outcome WHERE deal_card_id=? ORDER BY category,updated_at DESC,id DESC`).all(dealCardId) as Array<Record<string, unknown>>).map((row) => ({ ...row, facts: JSON.parse(String(row.facts_json ?? '{}')) }));
}

export interface PublicRecordSubject {
  county?: string | null;
  state?: string | null;
  city?: string | null;
  township?: string | null;
  apn?: string | null;
  owner?: string | null;
  address?: string | null;
  legalDescription?: string | null;
  acreage?: number | null;
  lat?: number | null;
  lng?: number | null;
}

export function publicRecordSearchHierarchy(subject: PublicRecordSubject): {
  subjectReady: boolean;
  roadOnlyAccepted: boolean;
  ownerIsDiscoveryOnly: true;
  identitySignals: string[];
  authorities: Array<{ level: string; label: string }>;
  warning: string;
} {
  const signals = [
    subject.apn ? 'APN' : '', subject.county ? 'county' : '', subject.state ? 'state' : '',
    subject.owner ? 'owner' : '', subject.address ? 'road/property address' : '', subject.legalDescription ? 'legal description' : '',
    subject.acreage != null ? 'acreage' : '', subject.lat != null && subject.lng != null ? 'coordinates' : '',
  ].filter(Boolean);
  const address = clean(subject.address);
  const roadOnlyAccepted = !!address && !/^\d+\s/.test(address);
  const strong = !!subject.apn && !!subject.county && !!subject.state && signals.length >= 4;
  const authorities = [
    subject.city ? { level: 'municipality', label: `${subject.city} municipal records` } : null,
    subject.township ? { level: 'township', label: `${subject.township} township records` } : null,
    subject.county ? { level: 'county', label: `${subject.county} County assessor/GIS` } : null,
    subject.county ? { level: 'county', label: `${subject.county} County tax office/trustee` } : null,
    subject.county ? { level: 'county', label: `${subject.county} County clerk/recorder/register of deeds` } : null,
    subject.county ? { level: 'county', label: `${subject.county} County planning/zoning authority` } : null,
    subject.state ? { level: 'state', label: `${subject.state} statewide parcel and tax systems` } : null,
  ].filter((row): row is { level: string; label: string } => !!row);
  return {
    subjectReady: strong,
    roadOnlyAccepted,
    ownerIsDiscoveryOnly: true,
    identitySignals: signals,
    authorities,
    warning: strong
      ? 'Match records by APN plus jurisdiction and corroborating parcel facts. Owner-name results are discovery only.'
      : 'Do not select a parcel from owner name or same-road proximity alone; obtain APN/jurisdiction and corroborating parcel evidence.',
  };
}

function existingCanonicalFact(dealCardId: number, key: string): string | null {
  const row = getLandosDb().prepare(`SELECT pc.* FROM landos_deal_card_property l JOIN landos_property_card pc ON pc.id=l.card_id WHERE l.deal_card_id=? ORDER BY CASE l.role WHEN 'subject' THEN 0 ELSE 1 END,l.id LIMIT 1`).get(dealCardId) as Record<string, unknown> | undefined;
  if (!row) return null;
  if (key === 'apn') return clean(row.apn);
  if (key === 'acreage') return row.acres == null ? null : String(row.acres);
  if (key === 'owner') return clean(row.owner);
  if (key === 'address') return clean(row.active_input_address);
  if (key === 'county') return clean(row.county);
  if (key === 'state') return clean(row.state);
  return null;
}

export async function persistLeadCardIntake(input: {
  dealCardId: number;
  text: string;
  submissionType?: 'general' | 'transcript';
  source?: string;
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  idempotencyKey?: string;
  imageArtifacts?: IntakeImageArtifactInput[];
  modelAnalyzer?: IntakeModelAnalyzer;
}): Promise<Record<string, unknown>> {
  const db = getLandosDb();
  const deal = db.prepare('SELECT id,entity FROM landos_deal_card WHERE id=?').get(input.dealCardId) as { id: number; entity: LandosEntity } | undefined;
  if (!deal) throw new Error('deal card not found');
  const idempotencyKey = clean(input.idempotencyKey, 200);
  if (idempotencyKey) {
    const existing = db.prepare(`SELECT id FROM landos_intake_submission WHERE deal_card_id=? AND idempotency_key=?`).get(input.dealCardId, idempotencyKey) as { id: number } | undefined;
    if (existing) return listLeadCardIntake(input.dealCardId).find((row) => row.id === existing.id)!;
  }
  // Store the operator's text byte-for-byte. Normalization is analysis-only.
  const original = input.text;
  const imageArtifacts = input.imageArtifacts ?? [];
  if (!original.trim() && !input.fileName && imageArtifacts.length === 0) throw new Error('submission is empty');
  const source = clean(input.source) || 'operator';
  const submissionId = Number(db.prepare(`INSERT INTO landos_intake_submission
    (deal_card_id,submission_type,source,original_text,original_file_name,original_file_url,mime_type,idempotency_key,status)
    VALUES (?,?,?,?,?,?,?,?, 'received')`).run(
    input.dealCardId,
    input.submissionType ?? 'general',
    source,
    original,
    clean(input.fileName),
    clean(input.fileUrl, 2000),
    clean(input.mimeType),
    idempotencyKey,
  ).lastInsertRowid);
  try {
    const extractedImageText = imageArtifacts.map((artifact) => artifact.extraction.exactText).filter(Boolean).join('\n\n');
    const analysisText = [original, extractedImageText].filter((part) => part.length > 0).join('\n\n');
    const analysis = await analyzeLeadCardIntake({
      text: analysisText || `Uploaded document: ${input.fileName}`,
      submissionType: input.submissionType,
      modelAnalyzer: input.modelAnalyzer,
    });
    const imageFacts: RoutedFact[] = imageArtifacts.flatMap((artifact) => Object.entries(artifact.extraction.candidates)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
      .map(([key, value]) => ({
        section: 'property' as const,
        key,
        value,
        status: 'candidate' as const,
      })));
    const factRows: Array<Record<string, unknown>> = [];
    for (const fact of [...analysis.facts, ...imageFacts]) {
      const accepted = existingCanonicalFact(input.dealCardId, fact.key);
      const differs = accepted && personAliasKey(accepted) !== personAliasKey(fact.value);
      const conflict = differs
        ? fact.status === 'candidate'
          ? `Existing accepted value "${accepted}" was not changed; screenshot candidate "${fact.value}" remains available for resolution.`
          : `Kept existing accepted value "${accepted}"; new ${fact.status} value "${fact.value}" is retained for operator review.`
        : '';
      const status = fact.status === 'candidate' ? 'candidate' : conflict ? 'conflict' : fact.status;
      const factSource = fact.status === 'candidate' ? 'smart intake image candidate' : `${source} submission`;
      const id = Number(db.prepare(`INSERT INTO landos_intake_fact (submission_id,deal_card_id,section,fact_key,value,fact_status,conflict_note,source) VALUES (?,?,?,?,?,?,?,?)`).run(submissionId, input.dealCardId, fact.section, fact.key, fact.value, status, conflict, factSource).lastInsertRowid);
      factRows.push({ id, ...fact, status, conflictNote: conflict });
    }
    const artifactRows: Array<Record<string, unknown>> = [];
    for (const artifact of imageArtifacts) {
      const artifactId = Number(db.prepare(`INSERT INTO landos_intake_artifact
        (submission_id,deal_card_id,document_upload_id,original_file_name,file_url,mime_type,byte_size,sha256,source_method,exact_extracted_text,extraction_json,extraction_status,extraction_model)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        submissionId,
        input.dealCardId,
        artifact.documentUploadId,
        artifact.originalFileName,
        artifact.fileUrl,
        artifact.mimeType,
        artifact.byteSize,
        artifact.sha256,
        artifact.sourceMethod,
        artifact.extraction.exactText,
        JSON.stringify(artifact.extraction),
        artifact.extraction.status,
        artifact.extraction.model,
      ).lastInsertRowid);
      for (const [key, value] of Object.entries(artifact.extraction.candidates)) {
        if (typeof value !== 'string' || !value) continue;
        db.prepare(`INSERT INTO landos_intake_candidate
          (submission_id,artifact_id,deal_card_id,candidate_key,value,confidence,uncertain,source)
          VALUES (?,?,?,?,?,'candidate',?,'image extraction')`).run(
          submissionId,
          artifactId,
          input.dealCardId,
          key,
          value,
          artifact.extraction.uncertainFields.includes(key) ? 1 : 0,
        );
      }
      artifactRows.push({
        id: artifactId,
        ...artifact,
        candidates: artifact.extraction.candidates,
        exactExtractedText: artifact.extraction.exactText,
        extractionStatus: artifact.extraction.status,
      });
    }
    const resources = analysis.resourceContacts.map((resource) => upsertResourceContact({ ...resource, dealCardId: input.dealCardId, linkedItems: [`intake:${submissionId}`] }));
    const card = db.prepare(`SELECT card_id FROM landos_deal_card_property WHERE deal_card_id=? ORDER BY CASE role WHEN 'subject' THEN 0 ELSE 1 END,id LIMIT 1`).get(input.dealCardId) as { card_id: number } | undefined;
    if (card) {
      db.prepare(`INSERT INTO landos_card_activity (card_id,agent_id,kind,summary,ref) VALUES (?,'landos/intake',?,?,?)`).run(card.card_id, input.submissionType === 'transcript' ? 'transcript_intake' : 'smart_intake', analysis.summary, `intake:${submissionId}`);
      for (const action of analysis.followUps) db.prepare(`INSERT INTO landos_card_next_action (card_id,action,status,created_by) VALUES (?,?,'open','landos/intake')`).run(card.card_id, action);
    }
    const routedSections = imageArtifacts.length > 0 ? unique([...analysis.sections, 'document', 'property'] as IntakeSection[]) : analysis.sections;
    db.prepare(`UPDATE landos_intake_submission SET summary=?,routed_sections_json=?,extracted_json=?,status='complete' WHERE id=?`).run(
      analysis.summary,
      JSON.stringify(routedSections),
      JSON.stringify({ transcript: analysis.transcript, followUps: analysis.followUps }),
      submissionId,
    );
    landosAudit('landos/intake', 'lead_card_intake_saved', `deal ${input.dealCardId}: submission ${submissionId}`, { entity: deal.entity, refTable: 'landos_intake_submission', refId: submissionId });
    return {
      id: submissionId,
      submissionType: input.submissionType ?? 'general',
      source,
      originalText: original,
      originalFileName: clean(input.fileName),
      originalFileUrl: clean(input.fileUrl, 2000),
      mimeType: clean(input.mimeType),
      summary: analysis.summary,
      sections: routedSections,
      transcript: analysis.transcript,
      followUps: analysis.followUps,
      facts: factRows,
      artifacts: artifactRows,
      resources,
      resolutionHandoff: null,
      status: 'complete',
    };
  } catch (error) {
    db.prepare(`UPDATE landos_intake_submission SET status='needs_review',summary=? WHERE id=?`).run(`Submission retained; organization needs review: ${(error as Error).message}`, submissionId);
    throw error;
  }
}

export function listLeadCardIntake(dealCardId: number): Array<Record<string, unknown>> {
  const db = getLandosDb();
  const rows = db.prepare(`SELECT * FROM landos_intake_submission WHERE deal_card_id=? ORDER BY created_at DESC,id DESC`).all(dealCardId) as Array<Record<string, unknown>>;
  const facts = db.prepare(`SELECT * FROM landos_intake_fact WHERE deal_card_id=? ORDER BY created_at DESC,id DESC`).all(dealCardId) as Array<Record<string, unknown>>;
  const artifacts = db.prepare(`SELECT * FROM landos_intake_artifact WHERE deal_card_id=? ORDER BY captured_at DESC,id DESC`).all(dealCardId) as Array<Record<string, unknown>>;
  const candidates = db.prepare(`SELECT * FROM landos_intake_candidate WHERE deal_card_id=? ORDER BY artifact_id,id`).all(dealCardId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const extracted = JSON.parse(String(row.extracted_json ?? '{}')) as { transcript?: TranscriptExtraction; [key: string]: unknown };
    if (extracted.transcript?.unresolvedQuestions?.length) {
      extracted.transcript = {
        ...extracted.transcript,
        unresolvedQuestions: unique(extracted.transcript.unresolvedQuestions.map((question) => clean(question.replace(/^(?:unresolved|question)\s*[:\-]\s*/i, ''), 500))),
      };
    }
    return {
      id: row.id, dealCardId: row.deal_card_id, submissionType: row.submission_type, source: row.source,
      originalText: row.original_text, originalFileName: row.original_file_name, originalFileUrl: row.original_file_url,
      mimeType: row.mime_type, summary: row.summary, sections: JSON.parse(String(row.routed_sections_json ?? '[]')),
      extracted, resolutionHandoff: JSON.parse(String(row.resolution_json ?? '{}')), status: row.status, createdAt: row.created_at,
      facts: facts.filter((fact) => fact.submission_id === row.id).map((fact) => ({ ...fact, conflictNote: fact.conflict_note })),
      artifacts: artifacts.filter((artifact) => artifact.submission_id === row.id).map((artifact) => {
        const extraction = JSON.parse(String(artifact.extraction_json ?? '{}')) as SmartIntakeImageExtraction;
        return {
          id: artifact.id,
          originalFileName: artifact.original_file_name,
          fileUrl: artifact.file_url,
          mimeType: artifact.mime_type,
          byteSize: artifact.byte_size,
          sha256: artifact.sha256,
          sourceMethod: artifact.source_method,
          exactExtractedText: artifact.exact_extracted_text,
          extractionStatus: artifact.extraction_status,
          extractionModel: artifact.extraction_model,
          uncertainFields: extraction.uncertainFields ?? [],
          missingFields: extraction.missingFields ?? [],
          notes: extraction.notes ?? [],
          otherFacts: extraction.otherFacts ?? [],
          capturedAt: artifact.captured_at,
          candidates: candidates.filter((candidate) => candidate.artifact_id === artifact.id).map((candidate) => ({
            id: candidate.id,
            key: candidate.candidate_key,
            value: candidate.value,
            confidence: candidate.confidence,
            uncertain: candidate.uncertain === 1,
            source: candidate.source,
          })),
        };
      }),
    };
  });
}

export function findLeadCardIntakeBySubmissionKey(
  dealCardId: number,
  idempotencyKey: string,
): Record<string, unknown> | null {
  const key = clean(idempotencyKey, 200);
  if (!key) return null;
  const row = getLandosDb().prepare(`SELECT id FROM landos_intake_submission WHERE deal_card_id=? AND idempotency_key=?`).get(dealCardId, key) as { id: number } | undefined;
  return row ? listLeadCardIntake(dealCardId).find((submission) => submission.id === row.id) ?? null : null;
}

export function updateLeadCardIntakeResolution(
  dealCardId: number,
  submissionId: number,
  resolution: Record<string, unknown>,
): void {
  const result = getLandosDb().prepare(`UPDATE landos_intake_submission SET resolution_json=? WHERE id=? AND deal_card_id=?`).run(JSON.stringify(resolution), submissionId, dealCardId);
  if (result.changes !== 1) throw new Error('intake submission not found');
}

export function updateLeadCardIntakeCandidates(input: {
  dealCardId: number;
  submissionId: number;
  values: Record<string, string>;
}): Array<Record<string, unknown>> {
  const db = getLandosDb();
  const artifacts = db.prepare(`SELECT id FROM landos_intake_artifact WHERE deal_card_id=? AND submission_id=?`).all(input.dealCardId, input.submissionId) as Array<{ id: number }>;
  if (artifacts.length === 0) throw new Error('image intake submission not found');
  const allowed = new Set(['owner', 'address', 'road', 'city', 'state', 'zip', 'county', 'apn', 'acreage', 'latitude', 'longitude', 'sourcePlatform']);
  for (const [key, rawValue] of Object.entries(input.values)) {
    if (!allowed.has(key)) continue;
    const value = clean(rawValue, 1_000);
    const existing = db.prepare(`SELECT id FROM landos_intake_candidate WHERE submission_id=? AND candidate_key=? ORDER BY id LIMIT 1`).get(input.submissionId, key) as { id: number } | undefined;
    if (existing) {
      db.prepare(`UPDATE landos_intake_candidate SET value=?,uncertain=0,source='operator corrected image candidate',updated_at=strftime('%s','now') WHERE id=?`).run(value, existing.id);
    } else if (value) {
      db.prepare(`INSERT INTO landos_intake_candidate (submission_id,artifact_id,deal_card_id,candidate_key,value,confidence,uncertain,source) VALUES (?,?,?,?,?,'candidate',0,'operator added image candidate')`).run(
        input.submissionId,
        artifacts[0].id,
        input.dealCardId,
        key,
        value,
      );
    }
  }
  landosAudit('landos/intake', 'image_candidates_edited', `deal ${input.dealCardId}: submission ${input.submissionId}`, { refTable: 'landos_intake_submission', refId: input.submissionId });
  return listLeadCardIntake(input.dealCardId);
}
