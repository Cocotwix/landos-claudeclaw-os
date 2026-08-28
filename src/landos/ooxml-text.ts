// LandOS — reading the text out of an Office file, with what Node already has.
//
// THE DEFECT THIS REPAIRS.
//
// Smart Intake accepted a DOCX purchase agreement or an XLSX comp sheet, filed
// it as evidence, and then told the operator "LandOS has no reader for this
// format yet". That was honest but weaker than it needed to be: the operator
// hands over the strongest document they have and LandOS declines to look at
// it. The multimodal model does not take these containers either, so no amount
// of routing to vision fixes it.
//
// It does not need a parser suite. DOCX, XLSX and PPTX are ZIP archives of XML
// parts, and Node's built-in `zlib` already inflates the only compression
// method they use. So this reads the archive directory, inflates the parts that
// carry visible text, and strips the tags. That is the whole thing.
//
// What this module deliberately is NOT:
//   • It is not an Office framework. It does not model documents, styles,
//     formulas, cells, revisions, or embedded objects. It recovers readable
//     text and nothing else, and a file it cannot read returns null so the
//     caller reports "retained, not interpreted" exactly as before.
//   • It is not an executor. Macro-bearing containers (.docm/.xlsm/.pptm) never
//     reach here — `classifyIntakeArtifact` routes active content to
//     `interpreter: 'none'` before any bytes are opened.
//   • It is not identity. Everything it returns is unconfirmed operator-supplied
//     text. `PERMANENT_MEMORY.md` invariants 2-4 are untouched.

import { inflateRawSync } from 'node:zlib';

/** One stored member of a ZIP archive. */
interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. Anything else is skipped, not guessed at. */
  method: number;
  offset: number;
  compressedSize: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * Read the archive's central directory.
 *
 * Returns an empty list for anything that is not a readable ZIP, including a
 * truncated upload — a file we cannot open is reported as unread, never as
 * empty content.
 */
function readZipDirectory(bytes: Buffer): ZipEntry[] {
  // The end-of-central-directory record sits in the last 64 KB (22 fixed bytes
  // plus a comment that cannot exceed 65535).
  const scanFrom = Math.max(0, bytes.length - 66_000);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= scanFrom; i -= 1) {
    if (bytes.readUInt32LE(i) === EOCD_SIGNATURE) { eocd = i; break; }
  }
  if (eocd < 0) return [];

  const count = bytes.readUInt16LE(eocd + 10);
  let position = bytes.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (position + 46 > bytes.length) break;
    if (bytes.readUInt32LE(position) !== CENTRAL_SIGNATURE) break;
    const nameLength = bytes.readUInt16LE(position + 28);
    const extraLength = bytes.readUInt16LE(position + 30);
    const commentLength = bytes.readUInt16LE(position + 32);
    entries.push({
      name: bytes.toString('utf8', position + 46, position + 46 + nameLength),
      method: bytes.readUInt16LE(position + 10),
      compressedSize: bytes.readUInt32LE(position + 20),
      offset: bytes.readUInt32LE(position + 42),
    });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Inflate one member, or null when it is unreadable or uses another method. */
function readZipEntry(bytes: Buffer, entry: ZipEntry): string | null {
  const header = entry.offset;
  if (header + 30 > bytes.length) return null;
  if (bytes.readUInt32LE(header) !== LOCAL_SIGNATURE) return null;
  // The local header repeats the name and carries its OWN extra-field length,
  // which routinely differs from the central directory's.
  const nameLength = bytes.readUInt16LE(header + 26);
  const extraLength = bytes.readUInt16LE(header + 28);
  const start = header + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) return null;
  const payload = bytes.subarray(start, end);
  try {
    if (entry.method === 0) return payload.toString('utf8');
    if (entry.method === 8) return inflateRawSync(payload).toString('utf8');
  } catch {
    return null;
  }
  return null;
}

/** Decode the five XML entities OOXML actually emits. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * Turn one OOXML part into readable text.
 *
 * Paragraph, row, cell, line-break and slide boundaries become whitespace
 * BEFORE tags are stripped, so a table does not collapse into one run-on line
 * and a spreadsheet keeps its shape.
 */
function xmlPartToText(xml: string): string {
  return decodeXmlEntities(
    xml
      // Word paragraphs / breaks, spreadsheet rows, presentation paragraphs.
      .replace(/<\/(?:w:p|a:p|w:tr|row)>/gi, '\n')
      .replace(/<(?:w:br|w:cr|a:br)\b[^>]*\/?>/gi, '\n')
      // Word table cells and spreadsheet cells separate horizontally.
      .replace(/<\/(?:w:tc|c)>/gi, '\t')
      .replace(/<[^>]*>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, (run) => (run.includes('\t') ? '\t' : ' ')).trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** The parts that carry visible text, in the order a reader would meet them. */
function textParts(entries: ZipEntry[]): ZipEntry[] {
  const wanted = entries.filter((entry) => (
    /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(entry.name)
    || /^xl\/(?:sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/i.test(entry.name)
    || /^ppt\/(?:slides\/slide\d+\.xml|notesSlides\/notesSlide\d+\.xml)$/i.test(entry.name)
  ));
  // sharedStrings holds every XLSX label, so it must precede the sheets that
  // reference it or a spreadsheet reads as bare numbers.
  return wanted.sort((a, b) => {
    const rank = (name: string) => (
      /^word\/document\.xml$/i.test(name) ? 0
        : /sharedStrings/i.test(name) ? 0
          : 1);
    return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'en');
  });
}

/** File extensions this reader handles. Macro-bearing variants are excluded on
 *  purpose: they are active content and never opened. */
export const OOXML_EXTENSIONS = ['docx', 'xlsx', 'pptx'] as const;

export const OOXML_MIME_TYPES: readonly string[] = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

/** Cap the recovered text so one pathological document cannot flood the deal
 *  record or a model prompt. Documents this size are read to their first
 *  200,000 characters and said to be truncated. */
export const OOXML_TEXT_LIMIT = 200_000;

export interface OoxmlText {
  text: string;
  /** Archive members actually read, for the provenance note. */
  parts: string[];
  truncated: boolean;
}

/**
 * Read an OOXML container's visible text.
 *
 * Returns null when the bytes are not a readable OOXML archive or carry no text
 * part — the caller then reports the file as retained and uninterpreted, which
 * is the correct answer and the one it already gave.
 */
export function readOoxmlText(bytes: Buffer): OoxmlText | null {
  const entries = readZipDirectory(bytes);
  if (!entries.length) return null;
  const parts = textParts(entries);
  if (!parts.length) return null;

  const chunks: string[] = [];
  const read: string[] = [];
  for (const part of parts) {
    const xml = readZipEntry(bytes, part);
    if (xml === null) continue;
    const text = xmlPartToText(xml);
    if (!text) continue;
    read.push(part.name);
    chunks.push(text);
    if (chunks.join('\n').length > OOXML_TEXT_LIMIT) break;
  }
  if (!chunks.length) return null;

  const joined = chunks.join('\n');
  return {
    text: joined.slice(0, OOXML_TEXT_LIMIT),
    parts: read,
    truncated: joined.length > OOXML_TEXT_LIMIT,
  };
}
