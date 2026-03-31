/**
 * Client-side .docx rebuilder.
 * Takes the original file + modified document.xml and reconstructs the .docx.
 * Also provides paragraph-level XML manipulation by index.
 */

import JSZip from 'jszip';

/**
 * Rebuild a .docx file with the modified document.xml.
 */
export async function rebuildDocx(
  originalFile: File,
  modifiedDocumentXml: string,
): Promise<Blob> {
  const buffer = await originalFile.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer, { createFolders: false });

  zip.file('word/document.xml', modifiedDocumentXml);

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return blob;
}

/**
 * Find all <w:p ...>...</w:p> paragraph boundaries using indexOf.
 * Much more reliable than regex on multi-MB single-line XML.
 * Returns start/end character positions for each paragraph.
 */
export function findParagraphPositions(xml: string): Array<{ start: number; end: number }> {
  const positions: Array<{ start: number; end: number }> = [];
  const openTag = '<w:p';
  const closeTag = '</w:p>';
  let searchFrom = 0;

  while (searchFrom < xml.length) {
    const openIdx = xml.indexOf(openTag, searchFrom);
    if (openIdx === -1) break;

    // Verify it's actually <w:p> or <w:p ... (not <w:pPr etc.)
    const charAfterTag = xml[openIdx + openTag.length];
    if (charAfterTag !== '>' && charAfterTag !== ' ') {
      searchFrom = openIdx + openTag.length;
      continue;
    }

    // Find the matching </w:p> — handle nested tags by counting depth
    let depth = 1;
    let pos = openIdx + openTag.length;
    while (depth > 0 && pos < xml.length) {
      const nextOpen = xml.indexOf(openTag, pos);
      const nextClose = xml.indexOf(closeTag, pos);

      if (nextClose === -1) break; // malformed XML

      if (nextOpen !== -1 && nextOpen < nextClose) {
        // Check it's really <w:p> or <w:p ..., not <w:pPr
        const charAfter = xml[nextOpen + openTag.length];
        if (charAfter === '>' || charAfter === ' ') {
          depth++;
        }
        pos = nextOpen + openTag.length;
      } else {
        depth--;
        if (depth === 0) {
          const endPos = nextClose + closeTag.length;
          positions.push({ start: openIdx, end: endPos });
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
 * Extract text content from a single paragraph XML string.
 */
function extractParaText(paraXml: string): string {
  const texts: string[] = [];
  const openTag = '<w:t';
  const closeTag = '</w:t>';
  let pos = 0;

  while (pos < paraXml.length) {
    const openIdx = paraXml.indexOf(openTag, pos);
    if (openIdx === -1) break;

    // Find the end of the opening tag
    const tagEnd = paraXml.indexOf('>', openIdx);
    if (tagEnd === -1) break;

    // Find the closing </w:t>
    const closeIdx = paraXml.indexOf(closeTag, tagEnd + 1);
    if (closeIdx === -1) break;

    texts.push(paraXml.substring(tagEnd + 1, closeIdx));
    pos = closeIdx + closeTag.length;
  }

  return texts.join('');
}

/**
 * Get text content of paragraphs in a range.
 * Uses indexOf-based parsing — safe on large single-line XML.
 */
export function getParagraphTexts(
  fullXml: string,
  startPara: number,
  endPara: number
): string[] {
  const positions = findParagraphPositions(fullXml);
  const results: string[] = [];

  for (let i = startPara; i <= endPara && i < positions.length; i++) {
    const paraXml = fullXml.substring(positions[i].start, positions[i].end);
    results.push(extractParaText(paraXml));
  }

  return results;
}

/**
 * Modify a paragraph at a given absolute index in the XML.
 *
 * Actions:
 * - 'delete_paragraph': removes the entire <w:p> element
 * - 'delete_text': finds textToDelete in the paragraph's <w:t> elements and removes it
 * - 'replace_text': finds oldText in the paragraph's <w:t> elements and replaces with newText
 * - 'insert_after': inserts a new <w:p> paragraph with newText after the target paragraph
 *
 * Returns the modified full XML string.
 */
export function modifyParagraphAtIndex(
  xml: string,
  paraIndex: number,
  action: 'delete_paragraph' | 'delete_text' | 'replace_text' | 'insert_after',
  options?: { oldText?: string; newText?: string; textToDelete?: string }
): string {
  const positions = findParagraphPositions(xml);

  if (paraIndex < 0 || paraIndex >= positions.length) {
    return xml; // out of bounds — no-op
  }

  const { start, end } = positions[paraIndex];

  switch (action) {
    case 'delete_paragraph': {
      return xml.substring(0, start) + xml.substring(end);
    }

    case 'delete_text': {
      const textToDelete = options?.textToDelete;
      if (!textToDelete) return xml;

      const paraXml = xml.substring(start, end);
      const newParaXml = replaceInWt(paraXml, textToDelete, '');
      return xml.substring(0, start) + newParaXml + xml.substring(end);
    }

    case 'replace_text': {
      const oldText = options?.oldText;
      const newText = options?.newText;
      if (!oldText || newText === undefined) return xml;

      const paraXml = xml.substring(start, end);
      const newParaXml = replaceInWt(paraXml, oldText, newText);
      return xml.substring(0, start) + newParaXml + xml.substring(end);
    }

    case 'insert_after': {
      const newText = options?.newText;
      if (!newText) return xml;

      // Create a minimal paragraph with the text
      const newPara = `<w:p><w:r><w:t xml:space="preserve">${escapeXml(newText)}</w:t></w:r></w:p>`;
      return xml.substring(0, end) + newPara + xml.substring(end);
    }

    default:
      return xml;
  }
}

/**
 * Replace text inside <w:t> elements of a paragraph.
 * Handles text split across multiple <w:t> elements by concatenating and redistributing.
 */
function replaceInWt(paraXml: string, searchText: string, replaceText: string): string {
  // First, try simple indexOf across the entire paragraph text
  // Collect all <w:t> positions and their text
  const wtPositions: Array<{ tagStart: number; textStart: number; textEnd: number; closeEnd: number; text: string }> = [];
  let pos = 0;

  while (pos < paraXml.length) {
    const openIdx = paraXml.indexOf('<w:t', pos);
    if (openIdx === -1) break;
    const tagEnd = paraXml.indexOf('>', openIdx);
    if (tagEnd === -1) break;
    const closeIdx = paraXml.indexOf('</w:t>', tagEnd + 1);
    if (closeIdx === -1) break;

    wtPositions.push({
      tagStart: openIdx,
      textStart: tagEnd + 1,
      textEnd: closeIdx,
      closeEnd: closeIdx + 6,
      text: paraXml.substring(tagEnd + 1, closeIdx),
    });
    pos = closeIdx + 6;
  }

  if (wtPositions.length === 0) return paraXml;

  // Concatenate all text
  const fullText = wtPositions.map((w) => w.text).join('');
  const searchIdx = fullText.indexOf(searchText);

  if (searchIdx === -1) return paraXml; // text not found

  // Replace in the concatenated text
  const newFullText = fullText.substring(0, searchIdx) + replaceText + fullText.substring(searchIdx + searchText.length);

  // Redistribute the new text across the existing <w:t> elements
  // Strategy: put all text in the first <w:t>, empty out the rest
  // This preserves the XML structure while updating the content
  let result = paraXml;

  // Work backwards to preserve positions
  for (let i = wtPositions.length - 1; i >= 0; i--) {
    const wt = wtPositions[i];
    if (i === 0) {
      // First <w:t> gets all the new text
      result = result.substring(0, wt.textStart) + newFullText + result.substring(wt.textEnd);
    } else {
      // Other <w:t> elements get emptied
      result = result.substring(0, wt.textStart) + result.substring(wt.textEnd);
    }
  }

  return result;
}

/**
 * Escape special XML characters.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Language markers for section detection in raw XML.
 */
const LANG_MARKERS: Record<string, string> = {
  english: 'EN', français: 'FR', deutsch: 'DE', nederlands: 'NL',
  русский: 'RU', español: 'ES', italiano: 'IT', العربية: 'AR',
  polski: 'PL', português: 'PT', česky: 'CS', magyar: 'HU',
  română: 'RO', türkçe: 'TR',
};

export interface RawSection {
  lang: string;
  startPara: number;
  endPara: number;
}

/**
 * Detect language sections by scanning paragraph texts in raw XML.
 * No parser needed — uses indexOf-based paragraph/text extraction.
 */
export function detectSectionsInRawXml(xml: string): RawSection[] {
  const positions = findParagraphPositions(xml);
  const markers: Array<{ index: number; lang: string }> = [];

  for (let i = 0; i < positions.length; i++) {
    const paraXml = xml.substring(positions[i].start, positions[i].end);
    const text = extractParaText(paraXml).trim();
    if (!text) continue;

    // Remove brackets: "[English]" → "English"
    const cleaned = text.replace(/^\[\s*/, '').replace(/\s*\]$/, '').trim().toLowerCase();
    const lang = LANG_MARKERS[cleaned];
    if (lang && !markers.some((m) => m.lang === lang)) {
      markers.push({ index: i, lang });
    }
  }

  if (markers.length === 0) return [];
  markers.sort((a, b) => a.index - b.index);

  const sections: RawSection[] = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? markers[i + 1].index - 1 : positions.length - 1;
    sections.push({ lang: markers[i].lang, startPara: start, endPara: end });
  }
  return sections;
}

export interface SectionModification {
  relativeParagraphIndex: number;
  action: 'delete_paragraph' | 'replace_text' | 'insert_after';
  newText?: string;
}

/**
 * Apply a batch of modifications to a document section.
 * Sorts modifications by relative index DESCENDING and applies each one,
 * recalculating paragraph positions before each operation.
 */
export function applyModificationsToSection(
  xml: string,
  sectionStartPara: number,
  modifications: SectionModification[]
): string {
  // Sort by relative index DESCENDING (last paragraph first).
  // For same index: insert_after before delete_paragraph (insert must happen
  // while the target paragraph still exists at that position).
  const actionOrder: Record<string, number> = { insert_after: 0, replace_text: 1, delete_paragraph: 2 };
  const sorted = [...modifications].sort((a, b) => {
    if (a.relativeParagraphIndex !== b.relativeParagraphIndex) {
      return b.relativeParagraphIndex - a.relativeParagraphIndex;
    }
    return (actionOrder[a.action] ?? 1) - (actionOrder[b.action] ?? 1);
  });

  let currentXml = xml;

  for (const mod of sorted) {
    const positions = findParagraphPositions(currentXml);
    const absIdx = sectionStartPara + mod.relativeParagraphIndex;

    if (absIdx < 0 || absIdx >= positions.length) {
      // For insert_after, clamp to the last paragraph if index is just beyond section end
      if (mod.action === 'insert_after' && absIdx === positions.length && positions.length > 0) {
        const lastPos = positions[positions.length - 1];
        const newPara = `<w:p><w:r><w:t xml:space="preserve">${escapeXml(mod.newText || '')}</w:t></w:r></w:p>`;
        currentXml = currentXml.substring(0, lastPos.end) + newPara + currentXml.substring(lastPos.end);
      }
      continue;
    }

    const { start, end } = positions[absIdx];

    switch (mod.action) {
      case 'delete_paragraph':
        currentXml = currentXml.substring(0, start) + currentXml.substring(end);
        break;

      case 'replace_text': {
        if (!mod.newText) break;
        const paraXml = currentXml.substring(start, end);
        const fullText = extractParaText(paraXml);
        if (fullText) {
          const newParaXml = replaceInWt(paraXml, fullText, mod.newText);
          currentXml = currentXml.substring(0, start) + newParaXml + currentXml.substring(end);
        }
        break;
      }

      case 'insert_after': {
        if (!mod.newText) break;
        const newPara = `<w:p><w:r><w:t xml:space="preserve">${escapeXml(mod.newText)}</w:t></w:r></w:p>`;
        currentXml = currentXml.substring(0, end) + newPara + currentXml.substring(end);
        break;
      }
    }
  }

  return currentXml;
}
