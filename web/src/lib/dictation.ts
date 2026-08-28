// Smart Intake dictation — turning recognizer events into composer text.
//
// THE DEFECT THIS REPAIRS. The microphone handler took every result from
// `event.resultIndex` and appended it, without ever asking whether it was
// final. A recognizer emits a GROWING hypothesis for one utterance — "Okay",
// "Okay so", "Okay so this" — and each one was appended on top of the last, so
// speaking a sentence once produced every intermediate guess concatenated:
// "Okay Okay so Okay so this…".
//
// The rule that replaces it: FINALITY decides what is kept. A final result is
// folded in exactly once and the high-water mark advances past it permanently.
// Everything still provisional is returned separately as a draft, which the
// caller REPLACES on every event — a hypothesis is a preview, not a
// contribution.
//
// Pure and DOM-free on purpose, so the behaviour is testable without a browser
// and the component keeps only the wiring.

/**
 * Join two pieces of dictated text the way a person would write them.
 *
 * One space between them, none before punctuation, and nothing added when
 * either side is empty — so dictation into an empty composer does not open with
 * a space, and dictation after typed text does not run into it.
 */
export function joinDictation(before: string, after: string): string {
  if (!after) return before;
  if (!before) return after;
  if (/\s$/.test(before) || /^[\s,.;:!?]/.test(after)) return `${before}${after}`;
  return `${before} ${after}`;
}

/** One recognition result, in the shape the Web Speech API delivers. */
export interface SpeechResultLike {
  isFinal?: boolean;
  [index: number]: { transcript?: string } | undefined;
}

/**
 * Fold one `onresult` event into newly finalized text plus a replaceable draft.
 *
 * `consumed` is a high-water mark rather than `event.resultIndex` on purpose:
 * engines differ in whether they rewind `resultIndex` back over results they
 * have already finalized, and re-finalizing one is exactly the duplication this
 * exists to prevent.
 */
export function foldSpeechResults(
  event: { results?: ArrayLike<SpeechResultLike>; resultIndex?: number },
  consumed: number,
): { finalized: string; draft: string; consumed: number } {
  const results = event.results ?? ([] as unknown as ArrayLike<SpeechResultLike>);
  let finalized = '';
  let draft = '';
  let nextConsumed = consumed;
  for (let index = consumed; index < results.length; index += 1) {
    const result = results[index];
    const transcript = String(result?.[0]?.transcript ?? '').trim();
    if (result?.isFinal) {
      if (transcript) finalized = joinDictation(finalized, transcript);
      nextConsumed = index + 1;
    } else if (transcript) {
      draft = joinDictation(draft, transcript);
    }
  }
  return { finalized, draft, consumed: nextConsumed };
}
