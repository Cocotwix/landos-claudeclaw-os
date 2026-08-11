// LandOS — does this official source actually require an account?
//
// Read from what the portal really answered, never from what the vendor is
// reputed to do. Three questions, answered separately because they have
// different consequences:
//
//   1. Can the public search be reached without logging in?
//   2. If not, is there a registration path?
//   3. Does anything on that path cost money?
//
// (3) dominates (2). The moment a subscription, credit purchase, payment
// method or per-document price is in the way, this reports PAID and the
// registration path is not taken. LandOS never spends money on its own.
//
// This module reads. It does not register, log in, click, or fill anything.

import {
  type AccessRequirement,
  type RegistrationAvailability,
} from './public-record-access-types.js';

export interface AccessProbeResponse {
  status: number;
  body: string;
  /** URL after redirects. */
  url: string;
  contentType: string;
  /** An edge refusal is a transport fact, not an authentication fact. */
  blocked?: boolean;
}

export interface AuthDetection {
  requirement: AccessRequirement;
  registration: RegistrationAvailability;
  loginUrl: string | null;
  registrationUrl: string | null;
  /**
   * A free login can still front paid documents. Recorded separately so the
   * zoning sprint knows searching is fine while ordering a copy is not.
   */
  paidRecordsObserved: boolean;
  /** Human-readable evidence. Never contains a credential or a query token. */
  signals: string[];
}

/* ─────────────────────────────── markers ─────────────────────────────── */

/** Money in the way of ACCESS. These stop registration outright. */
const PAID_ACCESS_MARKERS: Array<[RegExp, string]> = [
  [/\bsubscription\s+(is\s+)?required\b/i, 'Subscription required'],
  [/\bsubscribe\s+to\s+(search|access|view|continue)\b/i, 'Subscription gate'],
  [/\b(purchase|buy)\s+(credits?|tokens?|a\s+subscription)\b/i, 'Credit purchase required'],
  [/\bpayment\s+(method|information)\s+(is\s+)?required\b/i, 'Payment method required'],
  [/\bcredit\s+card\s+(is\s+)?required\b/i, 'Credit card required'],
  [/\bpaid\s+(subscribers?|members?|accounts?)\s+only\b/i, 'Paid accounts only'],
  [/\bfree\s+trial\b/i, 'Free trial that may convert to paid'],
  [/\$\s?\d[\d,]*(\.\d{2})?\s*(per|\/)\s*(document|report|search|page|copy|month|year|user)\b/i, 'Priced access'],
];

/** Money in the way of a DOCUMENT, behind an otherwise free login. */
const PAID_RECORD_MARKERS: Array<[RegExp, string]> = [
  [/\b(purchase|order|buy)\s+(this\s+)?(document|report|copy|certified)\b/i, 'Priced documents offered'],
  [/\badd\s+to\s+cart\b/i, 'Shopping cart present'],
  [/\bshopping\s+cart\b/i, 'Shopping cart present'],
  [/\bfee\s+schedule\b/i, 'Document fee schedule'],
];

/** The portal is telling us, in words, that we cannot search without an account. */
const AUTH_WALL_MARKERS: Array<[RegExp, string]> = [
  [/\byou\s+must\s+(be\s+)?(log(ged)?\s?in|sign(ed)?\s?in|register)/i, 'Login demanded in page text'],
  [/\b(please\s+)?(log\s?in|sign\s?in)\s+to\s+(continue|search|view|access)/i, 'Login demanded in page text'],
  [/\b(login|sign[- ]?in|authentication)\s+(is\s+)?required\b/i, 'Login required'],
  [/\bregistration\s+is\s+required\s+to\s+(search|access|view)/i, 'Registration required to search'],
  [/\b(registered|authorized|authenticated)\s+users?\s+only\b/i, 'Registered users only'],
  [/\byour\s+session\s+has\s+(expired|timed\s+out)\b/i, 'Session expired'],
  [/\bnot\s+authori[sz]ed\b/i, 'Not authorized'],
];

/** Evidence the public search is genuinely open. */
const PUBLIC_SEARCH_MARKERS: Array<[RegExp, string]> = [
  [/\b(parcel|property|owner|address|account)\s+(number\s+)?search\b/i, 'Public search form present'],
  [/\bsearch\s+(by\s+)?(parcel|property|owner|address|apn|pin)\b/i, 'Public search form present'],
  [/name="(searchvalue|parcelid|apn|pin|owner|address)"/i, 'Public search input present'],
];

const LOGIN_LINK = /<a\b[^>]*href\s*=\s*["']([^"']{1,300})["'][^>]*>(?:(?!<\/a>).){0,120}?\b(log\s?in|sign\s?in|logon|my\s+account)\b/gi;
const REGISTER_LINK = /<a\b[^>]*href\s*=\s*["']([^"']{1,300})["'][^>]*>(?:(?!<\/a>).){0,120}?\b(register|sign\s?up|create\s+(an?\s+)?account|new\s+user)\b/gi;
const FREE_REGISTRATION = /\b(free|no\s+(cost|charge|fee))\s+(account|registration|sign[- ]?up)\b|\bregistration\s+is\s+free\b|\bcreate\s+a\s+free\s+account\b/i;
const REGISTRATION_CLOSED = /\bregistration\s+is\s+(currently\s+)?(closed|disabled|unavailable|suspended)\b|\bnot\s+accepting\s+new\s+(accounts|registrations)\b/i;
const PASSWORD_FIELD = /<input\b[^>]*type\s*=\s*["']password["']/i;
const LOGIN_PATH = /\/(login|log-in|signin|sign-in|logon|account\/login|auth\/login|users?\/sign_?in)(\b|[/?#])/i;

/** How much of a document is worth scanning. Enough for a gate, not a whole GIS app. */
const SCAN_CEILING = 200_000;

/* ─────────────────────────────── detection ───────────────────────────── */

function firstLink(html: string, pattern: RegExp, base: string): string | null {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const href = (match[1] ?? '').trim();
    if (!href || /^(#|javascript:|mailto:)/i.test(href)) continue;
    try { return new URL(href, base).toString(); } catch { continue; }
  }
  return null;
}

function matched(text: string, markers: Array<[RegExp, string]>): string[] {
  const hits: string[] = [];
  for (const [pattern, label] of markers) {
    if (pattern.test(text) && !hits.includes(label)) hits.push(label);
  }
  return hits;
}

function isStructuredData(contentType: string, body: string): boolean {
  if (/json|geo\+json/i.test(contentType)) return true;
  const head = body.trimStart().slice(0, 2);
  return head === '{"' || head === '[{' || head === '[]';
}

/**
 * Classify one response.
 *
 * A blocked response says nothing about authentication — an edge refusal is
 * about the client, not the account — so it returns `unknown` rather than
 * inventing a login wall the operator would then be told to satisfy.
 */
export function detectAccessRequirement(response: AccessProbeResponse): AuthDetection {
  const base = response.url || '';
  const body = String(response.body ?? '').slice(0, SCAN_CEILING);
  const signals: string[] = [];

  if (response.blocked) {
    return {
      requirement: 'unknown',
      registration: 'not_applicable',
      loginUrl: null,
      registrationUrl: null,
      paidRecordsObserved: false,
      signals: ['Edge protection refused the client; authentication state is unknown.'],
    };
  }

  // A structured service that answered is the strongest possible evidence that
  // no account is needed. Nothing in an HTML gate can outrank real data.
  if (response.status >= 200 && response.status < 300 && isStructuredData(response.contentType, body)) {
    return {
      requirement: 'auth_not_required',
      registration: 'not_applicable',
      loginUrl: null,
      registrationUrl: null,
      paidRecordsObserved: false,
      signals: ['Structured service answered without authentication.'],
    };
  }

  const paidAccess = matched(body, PAID_ACCESS_MARKERS);
  const paidRecords = matched(body, PAID_RECORD_MARKERS);
  const authWall = matched(body, AUTH_WALL_MARKERS);
  const publicSearch = matched(body, PUBLIC_SEARCH_MARKERS);

  const loginUrl = firstLink(body, LOGIN_LINK, base) ?? (LOGIN_PATH.test(base) ? base : null);
  const registrationUrl = firstLink(body, REGISTER_LINK, base);
  const passwordField = PASSWORD_FIELD.test(body);
  const redirectedToLogin = LOGIN_PATH.test(base);
  const unauthorizedStatus = response.status === 401 || response.status === 403;

  if (redirectedToLogin) signals.push('Request landed on a login page');
  if (unauthorizedStatus) signals.push(`Source answered ${response.status}`);
  if (passwordField) signals.push('Password field present');
  signals.push(...authWall, ...publicSearch);

  /* requirement */
  let requirement: AccessRequirement;
  if (unauthorizedStatus || redirectedToLogin || authWall.length > 0) {
    requirement = 'auth_required';
  } else if (passwordField && publicSearch.length === 0) {
    // A password box and nowhere to search is a gate, whatever it calls itself.
    requirement = 'auth_required';
  } else if (loginUrl && publicSearch.length > 0) {
    requirement = 'auth_optional';
  } else if (publicSearch.length > 0 && response.status >= 200 && response.status < 300) {
    requirement = 'auth_not_required';
  } else if (loginUrl || passwordField) {
    requirement = 'auth_optional';
  } else {
    requirement = 'unknown';
  }

  /* registration availability — money first, always */
  let registration: RegistrationAvailability;
  if (paidAccess.length > 0) {
    registration = 'paid_access_required';
    signals.push(...paidAccess);
  } else if (requirement === 'auth_not_required') {
    registration = 'not_applicable';
  } else if (REGISTRATION_CLOSED.test(body)) {
    registration = 'registration_closed';
    signals.push('Registration closed to new accounts');
  } else if (registrationUrl && FREE_REGISTRATION.test(body)) {
    registration = 'free_registration_supported';
    signals.push('Source states registration is free');
  } else if (registrationUrl) {
    // Honest: a registration link is not proof of a free account.
    registration = 'free_registration_unproven';
    signals.push('Registration path present, cost not stated');
  } else if (requirement === 'auth_required') {
    registration = 'unsupported_registration';
    signals.push('No registration path was published on the gate');
  } else {
    registration = 'not_applicable';
  }

  if (paidRecords.length > 0) signals.push(...paidRecords);

  return {
    requirement,
    registration,
    loginUrl,
    registrationUrl,
    paidRecordsObserved: paidRecords.length > 0,
    signals: signals.slice(0, 12),
  };
}

/**
 * Merge repeated observations of the same deployment.
 *
 * Evidence of open access beats a later gate, because a portal that answered
 * once without an account demonstrably does not require one; and evidence of
 * money beats everything, because a wrong "free" reading is the one mistake
 * that could spend the operator's money.
 */
export function mergeAuthDetections(previous: AuthDetection | null, next: AuthDetection): AuthDetection {
  if (!previous) return next;
  const requirementRank: Record<AccessRequirement, number> = {
    auth_not_required: 3, auth_optional: 2, auth_required: 1, unknown: 0,
  };
  const requirement = requirementRank[next.requirement] > requirementRank[previous.requirement]
    ? next.requirement
    : previous.requirement;

  const paid = previous.registration === 'paid_access_required' || next.registration === 'paid_access_required';
  let registration: RegistrationAvailability;
  if (paid) {
    registration = 'paid_access_required';
  } else if (requirement === 'auth_not_required') {
    registration = 'not_applicable';
  } else {
    const rank: Record<RegistrationAvailability, number> = {
      paid_access_required: 6, free_registration_supported: 5, free_registration_unproven: 4,
      registration_closed: 3, unsupported_registration: 2, not_applicable: 1,
    };
    registration = rank[next.registration] > rank[previous.registration] ? next.registration : previous.registration;
  }

  const signals: string[] = [];
  for (const signal of [...previous.signals, ...next.signals]) {
    if (!signals.includes(signal)) signals.push(signal);
  }

  return {
    requirement,
    registration,
    loginUrl: next.loginUrl ?? previous.loginUrl,
    registrationUrl: next.registrationUrl ?? previous.registrationUrl,
    paidRecordsObserved: previous.paidRecordsObserved || next.paidRecordsObserved,
    signals: signals.slice(0, 12),
  };
}
