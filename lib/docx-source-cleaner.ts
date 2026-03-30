/**
 * Cleans the source section of a docx document by processing highlighted runs:
 * - RED highlights: remove the entire run (deletion)
 * - GREEN highlights: keep text, remove highlight attribute (addition — new text stays)
 * - CYAN highlights: keep text, remove highlight attribute (modification — updated text stays)
 *
 * Works on raw XML string using regex-based transformations to preserve
 * all OOXML formatting, namespaces, and attributes.
 */

import type { ModificationType } from './types/docx';

export interface AppliedModification {
  type: ModificationType;
  text: string;
  paragraphIndex: number;
  contextBefore: string;
  contextAfter: string;
}

function highlightToType(val: string): ModificationType {
  switch (val.toLowerCase()) {
    case 'red':
    case 'darkred':
      return 'DELETE';
    case 'green':
    case 'darkgreen':
      return 'ADD';
    case 'cyan':
    case 'blue':
    case 'darkblue':
      return 'MODIFY';
    default:
      return 'NONE';
  }
}

function extractTextFromRun(runXml: string): string {
  const texts: string[] = [];
  const tRegex = /<[^>]*:t[^>]*>([\s\S]*?)<\/[^>]*:t>/g;
  let m;
  while ((m = tRegex.exec(runXml)) !== null) {
    texts.push(m[1]);
  }
  return texts.join('');
}

function extractTextFromParagraph(paraXml: string): string {
  const texts: string[] = [];
  const tRegex = /<[^>]*:t[^>]*>([\s\S]*?)<\/[^>]*:t>/g;
  let m;
  while ((m = tRegex.exec(paraXml)) !== null) {
    texts.push(m[1]);
  }
  return texts.join('');
}

function removeHighlightFromRun(runXml: string): string {
  return runXml
    .replace(/<[^>]*:highlight[^/]*\/>/g, '')
    .replace(/<[^>]*:highlight[^>]*>[^<]*<\/[^>]*:highlight>/g, '');
}

function removeHighlightFromParagraphPr(paraXml: string): string {
  return paraXml.replace(
    /(<[^>]*:pPr[^>]*>)([\s\S]*?)(<\/[^>]*:pPr>)/g,
    (_fullMatch, open: string, content: string, close: string) => {
      const cleaned = content
        .replace(/<[^>]*:highlight[^/]*\/>/g, '')
        .replace(/<[^>]*:highlight[^>]*>[^<]*<\/[^>]*:highlight>/g, '');
      return open + cleaned + close;
    }
  );
}

function splitIntoParagraphs(xmlContent: string): {
  before: string;
  paragraphs: string[];
  after: string;
} {
  const paraRegex = /<([a-zA-Z0-9]+):p[\s>][\s\S]*?<\/\1:p>/g;
  const paragraphs: string[] = [];
  const positions: Array<{ start: number; end: number }> = [];

  let m;
  while ((m = paraRegex.exec(xmlContent)) !== null) {
    paragraphs.push(m[0]);
    positions.push({ start: m.index, end: m.index + m[0].length });
  }

  const before = positions.length > 0 ? xmlContent.substring(0, positions[0].start) : xmlContent;
  const after = positions.length > 0
    ? xmlContent.substring(positions[positions.length - 1].end)
    : '';

  return { before, paragraphs, after };
}

function getRunHighlight(runXml: string): string | null {
  const hlMatch = runXml.match(/<[^>]*:highlight[^>]*(?::val|val)="([^"]+)"/);
  return hlMatch ? hlMatch[1] : null;
}

function splitIntoRuns(paraXml: string): string[] {
  const runRegex = /<([a-zA-Z0-9]+):r[\s>][\s\S]*?<\/\1:r>/g;
  const runs: string[] = [];
  let m;
  while ((m = runRegex.exec(paraXml)) !== null) {
    runs.push(m[0]);
  }
  return runs;
}

function rebuildParagraph(
  originalParaXml: string,
  processedRuns: Array<string | null>
): string {
  const runRegex = /<([a-zA-Z0-9]+):r[\s>][\s\S]*?<\/\1:r>/g;
  let result = '';
  let lastEnd = 0;
  let runIndex = 0;

  let m;
  while ((m = runRegex.exec(originalParaXml)) !== null) {
    result += originalParaXml.substring(lastEnd, m.index);
    if (runIndex < processedRuns.length && processedRuns[runIndex] !== null) {
      result += processedRuns[runIndex];
    }
    lastEnd = m.index + m[0].length;
    runIndex++;
  }

  result += originalParaXml.substring(lastEnd);
  return result;
}

function getParagraphHighlight(paraXml: string): string | null {
  const pPrMatch = paraXml.match(/<[^>]*:pPr[^>]*>[\s\S]*?<\/[^>]*:pPr>/);
  if (!pPrMatch) return null;
  const rPrMatch = pPrMatch[0].match(/<[^>]*:rPr[^>]*>[\s\S]*?<\/[^>]*:rPr>/);
  if (!rPrMatch) return null;
  const hlMatch = rPrMatch[0].match(/<[^>]*:highlight[^>]*(?::val|val)="([^"]+)"/);
  return hlMatch ? hlMatch[1] : null;
}

export function cleanSourceSection(
  fullXml: string,
  sourceStartPara: number,
  sourceEndPara: number
): { cleanedXml: string; modifications: AppliedModification[] } {
  const { before, paragraphs, after } = splitIntoParagraphs(fullXml);
  const modifications: AppliedModification[] = [];

  const cleanedParagraphs = paragraphs.map((paraXml, pIdx) => {
    if (pIdx < sourceStartPara || pIdx > sourceEndPara) {
      return paraXml;
    }

    const paraHighlight = getParagraphHighlight(paraXml);
    const runs = splitIntoRuns(paraXml);
    if (runs.length === 0 && !paraHighlight) return paraXml;

    let hasChanges = false;
    const processedRuns: Array<string | null> = [];

    for (const runXml of runs) {
      const highlight = getRunHighlight(runXml) || paraHighlight;

      if (!highlight) {
        processedRuns.push(runXml);
        continue;
      }

      const modType = highlightToType(highlight);
      if (modType === 'NONE') {
        processedRuns.push(runXml);
        continue;
      }

      hasChanges = true;
      const text = extractTextFromRun(runXml);

      if (modType === 'DELETE') {
        processedRuns.push(null);
        modifications.push({
          type: 'DELETE',
          text,
          paragraphIndex: pIdx - sourceStartPara,
          contextBefore: pIdx > 0 ? extractTextFromParagraph(paragraphs[pIdx - 1]) : '',
          contextAfter: pIdx < paragraphs.length - 1 ? extractTextFromParagraph(paragraphs[pIdx + 1]) : '',
        });
      } else {
        const cleaned = removeHighlightFromRun(runXml);
        processedRuns.push(cleaned);
        modifications.push({
          type: modType,
          text,
          paragraphIndex: pIdx - sourceStartPara,
          contextBefore: pIdx > 0 ? extractTextFromParagraph(paragraphs[pIdx - 1]) : '',
          contextAfter: pIdx < paragraphs.length - 1 ? extractTextFromParagraph(paragraphs[pIdx + 1]) : '',
        });
      }
    }

    if (!hasChanges) return paraXml;

    let cleaned = rebuildParagraph(paraXml, processedRuns);
    if (paraHighlight) {
      cleaned = removeHighlightFromParagraphPr(cleaned);
    }
    return cleaned;
  });

  const cleanedXml = before + cleanedParagraphs.join('') + after;
  return { cleanedXml, modifications };
}

export function extractParagraphRangeText(
  fullXml: string,
  startPara: number,
  endPara: number
): string[] {
  const { paragraphs } = splitIntoParagraphs(fullXml);
  return paragraphs
    .slice(startPara, endPara + 1)
    .map(extractTextFromParagraph);
}

export function replaceParagraphRange(
  fullXml: string,
  startPara: number,
  endPara: number,
  newParagraphsXml: string
): string {
  const { before, paragraphs, after } = splitIntoParagraphs(fullXml);
  const result = [
    ...paragraphs.slice(0, startPara),
    newParagraphsXml,
    ...paragraphs.slice(endPara + 1),
  ];
  return before + result.join('') + after;
}
