/**
 * Ingest sanitization. Mitigates T1 (prompt injection through source content).
 *
 * Upstream text is DATA, never instruction. This strips the characters that
 * let text masquerade as something else — control codes, ANSI escapes,
 * bidirectional overrides, zero-width joiners — while preserving every
 * factual character a reader needs. It deliberately does not reword, redact,
 * or "detect" instructions: the defence is that the server never treats this
 * text as a directive, and that clients are told it is untrusted content.
 *
 * The character classes are built from numeric code points rather than
 * written as regex literals. Invisible characters in source are exactly the
 * hazard this module exists to remove, so they do not belong in its own text.
 */

/** [startInclusive, endInclusive] code point ranges. */
type CodeRange = readonly [number, number];

const ESC = 0x1b;

/** C0 controls except tab (0x09) and newline (0x0a), plus DEL and the C1 block. */
const CONTROL_RANGES: readonly CodeRange[] = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
];

/** Bidi embeddings, overrides, and isolates: can visually reorder text to hide content. */
const BIDI_RANGES: readonly CodeRange[] = [
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];

/** Zero-width and invisible formatting characters, plus BOM. */
const INVISIBLE_RANGES: readonly CodeRange[] = [
  [0x200b, 0x200f],
  [0x2060, 0x2064],
  [0xfeff, 0xfeff],
];

function classFromRanges(ranges: readonly CodeRange[]): RegExp {
  const body = ranges
    .map(([start, end]) =>
      start === end ? escapeCodePoint(start) : `${escapeCodePoint(start)}-${escapeCodePoint(end)}`,
    )
    .join('');
  return new RegExp(`[${body}]`, 'gu');
}

function escapeCodePoint(code: number): string {
  return `\\u${code.toString(16).padStart(4, '0')}`;
}

/** ANSI / VT escape sequences. Applied before the ESC byte itself is stripped. */
const ANSI = new RegExp(`${escapeCodePoint(ESC)}\\[[0-?]*[ -/]*[@-~]`, 'gu');
const CONTROL_CHARS = classFromRanges(CONTROL_RANGES);
const BIDI = classFromRanges(BIDI_RANGES);
const INVISIBLE = classFromRanges(INVISIBLE_RANGES);

export const MAX_FIELD_LENGTH = 4000;
export const MAX_URL_LENGTH = 500;

export function sanitizeText(input: string, maxLength = MAX_FIELD_LENGTH): string {
  const cleaned = input
    .replace(ANSI, '')
    .replace(CONTROL_CHARS, '')
    .replace(BIDI, '')
    .replace(INVISIBLE, '')
    .replace(/\r\n?/g, '\n')
    .trim();

  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

/**
 * Accept only absolute https URLs, and only within a sane length.
 * A field that fails is dropped rather than passed through, so a poisoned
 * record cannot turn into a citation pointing somewhere hostile (T4).
 */
export function sanitizeUrl(input: string): string | null {
  if (input.length === 0 || input.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  return url.protocol === 'https:' ? url.toString() : null;
}

export function sanitizeUrls(inputs: string[]): string[] {
  const out: string[] = [];
  for (const input of inputs) {
    const url = sanitizeUrl(input);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}
