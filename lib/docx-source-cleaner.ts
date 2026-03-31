/**
 * Cleans the source section of a docx document by processing highlighted runs:
 * - RED highlights: remove the entire run (deletion)
 * - GREEN highlights: keep text, remove highlight attribute (addition — new text stays)
 * - CYAN highlights: keep text, remove highlight attribute (modification — updated text stays)
 *
 * Uses indexOf-based parsing — safe on large single-line XML (5+ MB).
 * Returns the COMPLETE document XML with only the source section cleaned.
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

/**
 * Find all <w:p> paragraph boundaries using indexOf.
 */
function findParagraphPositions(xml: string): Array<{ start: number; end: number }> {
  const positions: Array<{ start: number; end: number }> = [];
  const openTag = '<w:p';
  const closeTag = '</w:p>';
  let searchFrom = 0;

  while (searchFrom < xml.length) {
    const openIdx = xml.indexOf(openTag, searchFrom);
    if (openIdx === -1) break;

    const charAfterTag = xml[openIdx + openTag.length];
    if (charAfterTag !== '>' && charAfterTag !== ' ') {
      searchFrom = openIdx + openTag.length;
      continue;
    }

    let depth = 1;
    let pos = openIdx + openTag.length;
    while (depth > 0 && pos < xml.length) {
      const nextOpen = xml.indexOf(openTag, pos);
      const nextClose = xml.indexOf(closeTag, pos);

      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        const charAfter = xml[nextOpen + openTag.length];
        if (charAfter === '>' || charAfter === ' ') {
          depth++;
        }
        pos = nextOpen + openTag.length;
      } else {
        depth--;
        if (depth === 0) {
          positions.push({ start: openIdx, end: nextClose + closeTag.length });
        }
        pos = nextClose + closeTag.length;
      }
    }

    searchFrom = positions.length > 0
      ? positions[positions.length - 1].end
      : openIdx + openTag.length;
  }

  return positions;
}

/**
 * Extract text from <w:t> elements inside a paragraph.
 */
function extractParaText(paraXml: string): string {
  const texts: string[] = [];
  let pos = 0;
  while (pos < paraXml.length) {
    const openIdx = paraXml.indexOf('<w:t', pos);
    if (openIdx === -1) break;
    const tagEnd = paraXml.indexOf('>', openIdx);
    if (tagEnd === -1) break;
    const closeIdx = paraXml.indexOf('</w:t>', tagEnd + 1);
    if (closeIdx === -1) break;
    texts.push(paraXml.substring(tagEnd + 1, closeIdx));
    pos = closeIdx + 6;
  }
  return texts.join('');
}

/**
 * Find all <w:r> run boundaries inside a paragraph using indexOf.
 */
function findRunPositions(paraXml: string): Array<{ start: number; end: number }> {
  const positions: Array<{ start: number; end: number }> = [];
  const openTag = '<w:r';
  const closeTag = '</w:r>';
  let searchFrom = 0;

  while (searchFrom < paraXml.length) {
    const openIdx = paraXml.indexOf(openTag, searchFrom);
    if (openIdx === -1) break;

    // Must be <w:r> or <w:r ..., not <w:rPr
    const charAfter = paraXml[openIdx + openTag.length];
    if (charAfter !== '>' && charAfter !== ' ') {
      searchFrom = openIdx + openTag.length;
      continue;
    }

    const closeIdx = paraXml.indexOf(closeTag, openIdx);
    if (closeIdx === -1) break;

    positions.push({ start: openIdx, end: closeIdx + closeTag.length });
    searchFrom = closeIdx + closeTag.length;
  }

  return positions;
}

/**
 * Get the highlight value from a run XML string.
 */
function getRunHighlight(runXml: string): string | null {
  // Look for <w:highlight w:val="..."/>
  const idx = runXml.indexOf('<w:highlight');
  if (idx === -1) return null;
  const valIdx = runXml.indexOf('w:val="', idx);
  if (valIdx === -1) return null;
  const valStart = valIdx + 7; // length of 'w:val="'
  const valEnd = runXml.indexOf('"', valStart);
  if (valEnd === -1) return null;
  const val = runXml.substring(valStart, valEnd);
  return val !== 'none' ? val : null;
}

/**
 * Get highlight from paragraph-level rPr (inside pPr).
 */
function getParagraphHighlight(paraXml: string): string | null {
  const pPrIdx = paraXml.indexOf('<w:pPr');
  if (pPrIdx === -1) return null;
  const pPrEnd = paraXml.indexOf('</w:pPr>', pPrIdx);
  if (pPrEnd === -1) return null;
  const pPrContent = paraXml.substring(pPrIdx, pPrEnd);

  // Look for highlight inside the rPr that's inside pPr
  const rPrIdx = pPrContent.indexOf('<w:rPr');
  if (rPrIdx === -1) return null;
  const rPrEnd = pPrContent.indexOf('</w:rPr>', rPrIdx);
  if (rPrEnd === -1) return null;

  return getRunHighlight(pPrContent.substring(rPrIdx, rPrEnd));
}

/**
 * Remove <w:highlight .../> from a string.
 */
function removeHighlight(xml: string): string {
  // Handle self-closing: <w:highlight w:val="..."/>
  let result = xml;
  let idx = result.indexOf('<w:highlight');
  while (idx !== -1) {
    const selfClose = result.indexOf('/>', idx);
    const openClose = result.indexOf('>', idx);
    if (selfClose !== -1 && selfClose <= openClose + 1) {
      // Self-closing tag
      result = result.substring(0, idx) + result.substring(selfClose + 2);
    } else {
      // Tag with closing </w:highlight>
      const endTag = result.indexOf('</w:highlight>', idx);
      if (endTag !== -1) {
        result = result.substring(0, idx) + result.substring(endTag + 14);
      } else {
        break;
      }
    }
    idx = result.indexOf('<w:highlight');
  }
  return result;
}

/**
 * Clean the source section of highlighted annotations.
 * Returns the COMPLETE document XML with source section cleaned.
 */
export function cleanSourceSection(
  fullXml: string,
  sourceStartPara: number,
  sourceEndPara: number
): { cleanedXml: string; modifications: AppliedModification[] } {
  const paraPositions = findParagraphPositions(fullXml);
  const modifications: AppliedModification[] = [];

  // We'll build the result by copying the original XML and replacing
  // modified paragraphs. Work backwards to preserve positions.
  const replacements: Array<{ start: number; end: number; newXml: string }> = [];

  for (let pIdx = sourceStartPara; pIdx <= sourceEndPara && pIdx < paraPositions.length; pIdx++) {
    const paraStart = paraPositions[pIdx].start;
    const paraEnd = paraPositions[pIdx].end;
    const paraXml = fullXml.substring(paraStart, paraEnd);

    const paraHighlight = getParagraphHighlight(paraXml);
    const runPositions = findRunPositions(paraXml);
    if (runPositions.length === 0 && !paraHighlight) continue;

    let hasChanges = false;
    // Build replacement paragraph by processing each run
    const parts: Array<{ start: number; end: number; replacement: string | null }> = [];

    for (const runPos of runPositions) {
      const runXml = paraXml.substring(runPos.start, runPos.end);
      const highlight = getRunHighlight(runXml) || paraHighlight;

      if (!highlight) continue;

      const modType = highlightToType(highlight);
      if (modType === 'NONE') continue;

      hasChanges = true;
      const text = extractParaText(runXml);

      const contextBefore = pIdx > 0
        ? extractParaText(fullXml.substring(paraPositions[pIdx - 1].start, paraPositions[pIdx - 1].end))
        : '';
      const contextAfter = pIdx < paraPositions.length - 1
        ? extractParaText(fullXml.substring(paraPositions[pIdx + 1].start, paraPositions[pIdx + 1].end))
        : '';

      if (modType === 'DELETE') {
        parts.push({ start: runPos.start, end: runPos.end, replacement: null });
        modifications.push({
          type: 'DELETE',
          text,
          paragraphIndex: pIdx - sourceStartPara,
          contextBefore,
          contextAfter,
        });
      } else {
        // ADD or MODIFY: keep text, remove highlight
        const cleaned = removeHighlight(runXml);
        parts.push({ start: runPos.start, end: runPos.end, replacement: cleaned });
        modifications.push({
          type: modType,
          text,
          paragraphIndex: pIdx - sourceStartPara,
          contextBefore,
          contextAfter,
        });
      }
    }

    if (!hasChanges) continue;

    // Check if ALL runs with text in this paragraph are DELETE
    // If so, remove the entire paragraph
    const allRunsAreDelete = runPositions.length > 0 && runPositions.every((runPos) => {
      const runXml = paraXml.substring(runPos.start, runPos.end);
      const highlight = getRunHighlight(runXml) || paraHighlight;
      if (!highlight) {
        // Non-highlighted run: only counts if it has meaningful text
        const text = extractParaText(runXml).trim();
        return text === '';
      }
      return highlightToType(highlight) === 'DELETE';
    });

    if (allRunsAreDelete) {
      // Remove entire paragraph
      replacements.push({ start: paraStart, end: paraEnd, newXml: '' });
      continue;
    }

    // Build the new paragraph XML by applying run replacements backwards
    let newParaXml = paraXml;
    for (let r = parts.length - 1; r >= 0; r--) {
      const part = parts[r];
      if (part.replacement === null) {
        // Delete the run
        newParaXml = newParaXml.substring(0, part.start) + newParaXml.substring(part.end);
      } else {
        newParaXml = newParaXml.substring(0, part.start) + part.replacement + newParaXml.substring(part.end);
      }
    }

    // Also remove paragraph-level highlight if present
    if (paraHighlight) {
      newParaXml = removeHighlight(newParaXml);
    }

    replacements.push({ start: paraStart, end: paraEnd, newXml: newParaXml });
  }

  // Apply all paragraph replacements backwards to preserve positions
  let cleanedXml = fullXml;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    cleanedXml = cleanedXml.substring(0, r.start) + r.newXml + cleanedXml.substring(r.end);
  }

  return { cleanedXml, modifications };
}
