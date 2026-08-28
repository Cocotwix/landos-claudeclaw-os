// Smart Intake dictation: the sentence lands once, not every guess at it.
//
// A recognizer emits a GROWING hypothesis for one utterance — "Okay", "Okay so",
// "Okay so this" — and only later marks a result final. The old handler appended
// every one of them, so speaking a sentence once filled the composer with each
// intermediate guess concatenated. These cover the rule that replaced it:
// finality decides what is kept, and an interim is a preview that gets replaced.

import { describe, expect, it } from 'vitest';
import { foldSpeechResults, joinDictation } from './dictation.js';

/** One recognition event, in the shape the Web Speech API delivers. */
const event = (results: Array<{ text: string; final: boolean }>, resultIndex = 0) => ({
  resultIndex,
  results: results.map((r) => ({ 0: { transcript: r.text }, isFinal: r.final })),
});

/** Drive a whole dictation session the way the component does. */
function dictate(base: string, events: Array<ReturnType<typeof event>>) {
  let committed = '';
  let consumed = 0;
  let draft = '';
  const rendered: string[] = [];
  for (const e of events) {
    const folded = foldSpeechResults(e, consumed);
    consumed = folded.consumed;
    committed = joinDictation(committed, folded.finalized);
    draft = folded.draft;
    rendered.push(joinDictation(base, joinDictation(committed, draft)));
  }
  // What `settle()` does when the microphone stops.
  committed = joinDictation(committed, draft);
  return { rendered, composer: joinDictation(base, committed), committed };
}

describe('Smart Intake dictation folds interim results instead of appending them', () => {
  const utterance = [
    event([{ text: 'Okay', final: false }]),
    event([{ text: 'Okay so', final: false }]),
    event([{ text: 'Okay so this', final: false }]),
    event([{ text: 'Okay so this is the Lake Butler parcel', final: false }]),
    event([{ text: 'Okay so this is the Lake Butler parcel', final: true }]),
  ];

  it('leaves the spoken sentence in the composer exactly once', () => {
    const { composer } = dictate('', utterance);
    expect(composer).toBe('Okay so this is the Lake Butler parcel');
    // The reported defect, stated as an assertion.
    expect(composer).not.toContain('Okay Okay');
    expect(composer.match(/Okay/g)?.length).toBe(1);
  });

  it('shows each interim as a replaceable live draft while speaking', () => {
    const { rendered } = dictate('', utterance);
    expect(rendered).toEqual([
      'Okay',
      'Okay so',
      'Okay so this',
      'Okay so this is the Lake Butler parcel',
      'Okay so this is the Lake Butler parcel',
    ]);
  });

  it('preserves text typed before the microphone opened', () => {
    const { composer } = dictate('Seller is Maria Hernandez.', utterance);
    expect(composer).toBe('Seller is Maria Hernandez. Okay so this is the Lake Butler parcel');
  });

  it('does not duplicate the last final transcript when the mic stops', () => {
    const { composer, committed } = dictate('', utterance);
    // The final arrived as a real result, so the draft was already empty when
    // `settle()` ran and could not add it a second time.
    expect(committed).toBe('Okay so this is the Lake Butler parcel');
    expect(composer).toBe('Okay so this is the Lake Butler parcel');
  });

  it('keeps speech the recognizer never finalized before it ended', () => {
    const { composer } = dictate('', [
      event([{ text: 'about seven', final: false }]),
      event([{ text: 'about seven acres', final: false }]),
    ]);
    expect(composer).toBe('about seven acres');
  });

  it('commits each final once even when the engine rewinds resultIndex', () => {
    const { composer } = dictate('', [
      event([{ text: 'First sentence.', final: true }]),
      // Same finalized result re-delivered — the high-water mark ignores it.
      event([{ text: 'First sentence.', final: true }, { text: 'Second', final: false }], 0),
      event([{ text: 'First sentence.', final: true }, { text: 'Second sentence.', final: true }], 0),
    ]);
    expect(composer).toBe('First sentence. Second sentence.');
  });

  it('appends a second dictation session after the first, without overwriting it', () => {
    const first = dictate('', utterance).composer;
    // A new session re-bases on whatever the composer now holds.
    const second = dictate(first, [
      event([{ text: 'It is', final: false }]),
      event([{ text: 'It is one and a half acres.', final: true }]),
    ]);
    expect(second.composer).toBe('Okay so this is the Lake Butler parcel It is one and a half acres.');
    expect(second.composer.match(/Lake Butler/g)?.length).toBe(1);
  });
});

describe('dictation spacing reads naturally', () => {
  it('adds one space between existing text and dictation, and none elsewhere', () => {
    expect(joinDictation('', 'hello')).toBe('hello');
    expect(joinDictation('typed', 'spoken')).toBe('typed spoken');
    expect(joinDictation('typed ', 'spoken')).toBe('typed spoken');
    expect(joinDictation('typed\n', 'spoken')).toBe('typed\nspoken');
    expect(joinDictation('typed', ', spoken')).toBe('typed, spoken');
    expect(joinDictation('typed', '')).toBe('typed');
  });
});
