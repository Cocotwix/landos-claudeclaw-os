// LandOS — the governed BrowserSourceReader.
//
// WHY THIS EXISTS. `BrowserSourceReader` (land-use-lanes.ts) has been the
// declared escalation seam for the land-use question set since those lanes
// were written. It was declared in five files and implemented in none, so
// `browserEscalationLane` reached this branch on every single run:
//
//     if (!input.browser) {
//       input.onNote?.('Browser escalation was available as a lane but no
//                       browser reader is wired into this run…');
//       return [];
//     }
//
// That one missing implementation is the shared root of the whole
// "deterministic collector → not found → UNRESOLVED → stop" defect class. The
// escalation ladder was complete in design and inert in fact: current zoning,
// controlling authority, zoning standards and subdivision regulations each
// declared a browser rung, and each of them silently skipped it. Nothing was
// broken in any of those four modules — the last rung of the ladder simply had
// no implementation to call.
//
// This module supplies it, once, for all four callers.
//
// WHAT IT IS NOT. This is a READER, not an agent. It opens no foreground tab,
// clicks nothing, types nothing, and submits nothing. It reads the rendered
// document of an official URL that some other component already decided is
// worth reading, and returns text. Deciding WHICH url to read stays with the
// lane, and deciding whether the text answers the question stays with the
// caller's evidence reader. Interactive GIS work is a separate capability with
// its own governance; this seam deliberately cannot do it.
//
// TRANSPORT. Direct request first, always — it is faster, cheaper, opens no
// tab and cannot disturb the operator. The governed background Chrome tab is
// an escalation for transport-level refusal only, which is exactly the
// `withBrowserFallback` contract this repo already proved for the government
// portal adapters. Nothing new is negotiated with any host.

import { logger } from '../logger.js';
import type { BrowserSourceReader } from './land-use-lanes.js';
import {
  defaultGovFetchText,
  htmlToText,
  type GovFetchText,
} from './gis-transport.js';
import {
  createBackgroundBrowserFetchText,
  withBrowserFallback,
  type GovBrowserTransportDeps,
} from './gov-browser-transport.js';

/** A page shorter than this carried no readable content worth returning. */
const MIN_USEFUL_TEXT = 40;

/**
 * Hard ceiling on returned text.
 *
 * An ordinance page can be a megabyte of markup. The evidence readers scan for
 * districts, standards and authority statements near the top of the document;
 * carrying the whole thing forward would cost far more than it adds, and a
 * bounded read is what keeps an escalation lane from becoming a rabbit hole.
 */
const MAX_TEXT_CHARS = 200_000;

/** Read a document title without parsing the whole document. */
export function titleFromHtml(html: string): string | null {
  const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  if (!match) return null;
  const title = htmlToText(match[1] ?? '');
  return title || null;
}

export interface BrowserSourceReaderDeps {
  /** The plain transport. Injected in tests. */
  direct?: GovFetchText;
  /** The browser-backed transport. Injected in tests. */
  browser?: GovFetchText;
  /** Background-tab configuration when the default browser transport is used. */
  transport?: GovBrowserTransportDeps;
  /** Called with the url whenever the read escalated into a browser tab. */
  onEscalate?: (url: string) => void;
  /** Called with a one-line note describing what the reader actually did. */
  onNote?: (note: string) => void;
}

/**
 * The production reader.
 *
 * Returns `null` — never a throw and never a fabricated page — when the source
 * cannot be read. A lane treats `null` as "this url did not answer", which is
 * the honest outcome and lets the race continue with the remaining candidates.
 */
export function createGovernedBrowserSourceReader(
  deps: BrowserSourceReaderDeps = {},
): BrowserSourceReader {
  const direct = deps.direct ?? defaultGovFetchText;
  const browser = deps.browser ?? createBackgroundBrowserFetchText(deps.transport ?? {});
  const fetchText = withBrowserFallback(direct, browser, {
    onFallback: (url) => {
      deps.onEscalate?.(url);
      deps.onNote?.(`Browser escalation opened a governed background tab for ${url} after the direct request was refused.`);
    },
  });

  return async ({ url, purpose, timeoutMs }) => {
    try {
      const response = await fetchText(url, { timeoutMs });

      // A challenge that never cleared is a block even in a browser. Saying so
      // is the point: the caller records a real external wall rather than
      // reporting the question as simply unanswered.
      if (response.blocked) {
        deps.onNote?.(`${url} refused the read with an anti-bot challenge that did not clear (${purpose}).`);
        logger.info({ event: 'browser_source_blocked', url, purpose }, 'browser_source_blocked');
        return null;
      }
      if (!response.body) {
        deps.onNote?.(`${url} returned no document body (${purpose}).`);
        return null;
      }

      const text = htmlToText(response.body).slice(0, MAX_TEXT_CHARS);
      if (text.length < MIN_USEFUL_TEXT) {
        deps.onNote?.(`${url} returned a document with no readable text (${purpose}).`);
        return null;
      }

      deps.onNote?.(
        `Read ${response.url || url} via ${response.via === 'background_browser' ? 'a governed background browser tab' : 'a direct request'} (${purpose}).`,
      );
      return {
        url: response.url || url,
        title: titleFromHtml(response.body),
        text,
      };
    } catch (error) {
      // An escalation lane that throws would fail the whole question. A source
      // that could not be read is a source that did not answer.
      logger.info(
        { event: 'browser_source_read_failed', url, purpose, msg: (error as Error)?.message },
        'browser_source_read_failed',
      );
      deps.onNote?.(`${url} could not be read (${(error as Error)?.message ?? 'unknown error'}).`);
      return null;
    }
  };
}
