/**
 * Automatic detection of language sections in JAC multilingual .docx documents.
 * Works generically — no hardcoded paragraph indices or language counts.
 */

export interface LanguageSection {
  lang: string;
  label: string;
  startPara: number;
  endPara: number;
  isSource: boolean;
  paragraphCount: number;
}

export interface SectionDetectionResult {
  headerRange: { start: number; end: number } | null;
  sections: LanguageSection[];
  sourceLang: string;
}

const LANGUAGE_MARKERS: Record<string, string> = {
  English: 'EN',
  Français: 'FR',
  Deutsch: 'DE',
  Nederlands: 'NL',
  Русский: 'RU',
  Español: 'ES',
  Italiano: 'IT',
  العربية: 'AR',
  Polski: 'PL',
  Português: 'PT',
  'Česky': 'CS',
  Magyar: 'HU',
  Română: 'RO',
  Türkçe: 'TR',
  中文: 'ZH',
  日本語: 'JA',
  한국어: 'KO',
};

interface ParsedParagraph {
  index: number;
  text: string;
  hasHighlight: boolean;
  highlightColors: Set<string>;
}

/**
 * Extract paragraph text and highlight info from the fast-xml-parser parsed document.
 */
function parseParagraphs(parsedDoc: Record<string, unknown>): ParsedParagraph[] {
  const doc = parsedDoc['w:document'] as Record<string, unknown> | undefined;
  if (!doc) return [];
  const body = doc['w:body'] as Record<string, unknown> | undefined;
  if (!body) return [];

  const rawParas = body['w:p'];
  const paragraphs: Record<string, unknown>[] = !rawParas
    ? []
    : Array.isArray(rawParas)
      ? rawParas
      : [rawParas];

  return paragraphs.map((para, index) => {
    const runs = ensureArray(para['w:r'] as unknown);
    let text = '';
    let hasHighlight = false;
    const highlightColors = new Set<string>();

    for (const run of runs) {
      const r = run as Record<string, unknown>;
      const wt = r['w:t'];
      text += extractRunText(wt);

      const rPr = r['w:rPr'] as Record<string, unknown> | undefined;
      if (rPr) {
        const hl = rPr['w:highlight'] as Record<string, unknown> | undefined;
        if (hl) {
          const val = hl['@_w:val'] as string | undefined;
          if (val && val !== 'none') {
            hasHighlight = true;
            highlightColors.add(val);
          }
        }
        const wColor = rPr['w:color'] as Record<string, unknown> | undefined;
        if (wColor) {
          const val = wColor['@_w:val'] as string | undefined;
          if (val && val !== 'auto' && val !== '000000') {
            // Check if this is a meaningful annotation color (not normal text)
            const lc = val.toLowerCase();
            if (lc !== '000000' && lc !== 'ffffff' && lc !== 'auto') {
              // Only flag as highlight for known annotation hex colors
              const num = parseInt(lc, 16);
              if (!isNaN(num)) {
                const r = (num >> 16) & 255;
                const g = (num >> 8) & 255;
                const b = num & 255;
                const brightness = r + g + b;
                if (brightness >= 60 && brightness <= 700) {
                  // Could be an annotation color - but don't flag as highlight
                  // unless it's clearly red/green/blue/cyan
                  if (
                    (r > 150 && g < 80 && b < 80) || // red
                    (r < 80 && g > 100 && b < 80) || // green
                    (r < 80 && g < 80 && b > 150) || // blue
                    (r < 80 && g > 150 && b > 150)   // cyan
                  ) {
                    hasHighlight = true;
                    highlightColors.add(val);
                  }
                }
              }
            }
          }
        }
      }
    }

    return { index, text: text.trim(), hasHighlight, highlightColors };
  });
}

function extractRunText(wt: unknown): string {
  if (typeof wt === 'string') return wt;
  if (wt && typeof wt === 'object' && '#text' in (wt as Record<string, unknown>)) {
    return String((wt as Record<string, unknown>)['#text']);
  }
  if (Array.isArray(wt)) {
    return wt.map(extractRunText).join('');
  }
  return '';
}

function ensureArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function matchLanguageMarker(text: string): { lang: string; label: string } | null {
  if (!text) return null;

  let cleaned = text.trim();
  // Remove brackets: "[English]" -> "English"
  cleaned = cleaned.replace(/^\[\s*/, '').replace(/\s*\]$/, '').trim();

  // Direct match
  if (LANGUAGE_MARKERS[cleaned]) {
    return { lang: LANGUAGE_MARKERS[cleaned], label: cleaned };
  }

  // Case-insensitive match
  for (const [marker, code] of Object.entries(LANGUAGE_MARKERS)) {
    if (cleaned.toLowerCase() === marker.toLowerCase()) {
      return { lang: code, label: marker };
    }
  }

  return null;
}

/**
 * Detect language sections in a parsed docx document.
 * The parsed doc comes from fast-xml-parser with the same config as client-docx-parser.
 */
export function detectLanguageSections(parsedDoc: Record<string, unknown>): SectionDetectionResult {
  const paragraphs = parseParagraphs(parsedDoc);
  if (paragraphs.length === 0) {
    return { headerRange: null, sections: [], sourceLang: 'EN' };
  }

  // Find paragraphs whose text matches a known language marker
  const markerPositions: Array<{ index: number; lang: string; label: string }> = [];

  for (const para of paragraphs) {
    if (!para.text) continue;
    const match = matchLanguageMarker(para.text);
    if (match && !markerPositions.some((m) => m.lang === match.lang)) {
      markerPositions.push({
        index: para.index,
        lang: match.lang,
        label: match.label,
      });
    }
  }

  if (markerPositions.length === 0) {
    // No markers found — treat entire document as single section
    return {
      headerRange: null,
      sections: [{
        lang: 'UNK',
        label: 'Document',
        startPara: 0,
        endPara: paragraphs.length - 1,
        isSource: true,
        paragraphCount: paragraphs.length,
      }],
      sourceLang: 'UNK',
    };
  }

  // Sort markers by position
  markerPositions.sort((a, b) => a.index - b.index);

  // Header is everything before the first marker
  const headerRange = markerPositions[0].index > 0
    ? { start: 0, end: markerPositions[0].index - 1 }
    : null;

  // Build sections — each section runs from its marker to just before the next marker (or end of doc)
  const sections: LanguageSection[] = [];
  for (let i = 0; i < markerPositions.length; i++) {
    const marker = markerPositions[i];
    const nextMarkerIndex = i + 1 < markerPositions.length
      ? markerPositions[i + 1].index
      : paragraphs.length;

    const startPara = marker.index;
    const endPara = nextMarkerIndex - 1;

    // Check if this section contains highlights
    let hasHighlights = false;
    for (let p = startPara; p <= endPara; p++) {
      if (paragraphs[p].hasHighlight) {
        hasHighlights = true;
        break;
      }
    }

    sections.push({
      lang: marker.lang,
      label: marker.label,
      startPara,
      endPara,
      isSource: hasHighlights,
      paragraphCount: endPara - startPara + 1,
    });
  }

  // Determine source language
  const sourceSection = sections.find((s) => s.isSource);
  const sourceLang = sourceSection?.lang ?? sections[0].lang;

  return { headerRange, sections, sourceLang };
}

/**
 * Extract the text content of all paragraphs in a given range.
 * Returns an array of paragraph texts (one per paragraph).
 */
export function extractSectionText(
  parsedDoc: Record<string, unknown>,
  startPara: number,
  endPara: number
): string[] {
  const paragraphs = parseParagraphs(parsedDoc);
  const texts: string[] = [];
  for (let i = startPara; i <= endPara && i < paragraphs.length; i++) {
    texts.push(paragraphs[i].text);
  }
  return texts;
}
