/**
 * Split a document section into chapters (groups of paragraphs between headings).
 * Used for chapter-based propagation that avoids the paragraph-index mapping problem
 * between source and target sections with different table structures.
 */

import { findParagraphPositions, extractParaText } from './docx-rebuilder';

export interface Chapter {
  title: string;
  startParaIdx: number;   // absolute paragraph index in full XML
  endParaIdx: number;     // absolute paragraph index (inclusive)
  paragraphCount: number;
}

export interface ParsedParagraph {
  originalIndex: number;  // 1-based (from [N])
  action: 'keep_or_replace' | 'delete' | 'insert';
  text: string;
}

/**
 * Check if a paragraph is inside a table cell by looking for unclosed <w:tc> before it.
 */
function isInsideTable(xml: string, paraStart: number): boolean {
  // Look back up to 5000 chars and count <w:tc> vs </w:tc> tags
  const lookback = xml.substring(Math.max(0, paraStart - 5000), paraStart);
  let depth = 0;
  let pos = 0;
  while (pos < lookback.length) {
    const nextOpen = lookback.indexOf('<w:tc', pos);
    const nextClose = lookback.indexOf('</w:tc>', pos);
    if (nextOpen === -1 && nextClose === -1) break;
    if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
      const charAfter = lookback[nextOpen + 5];
      if (charAfter === '>' || charAfter === ' ') depth++;
      pos = nextOpen + 5;
    } else {
      depth = Math.max(0, depth - 1);
      pos = nextClose + 7;
    }
  }
  return depth > 0;
}

/**
 * Check if a paragraph is a heading (chapter title).
 * Excludes paragraphs inside table cells.
 */
function isHeadingParagraph(paraXml: string, xml?: string, paraStart?: number): boolean {
  // Never treat table cell paragraphs as headings
  if (xml && paraStart !== undefined && isInsideTable(xml, paraStart)) {
    return false;
  }

  // Check for heading style in pPr
  const pPrIdx = paraXml.indexOf('<w:pPr');
  if (pPrIdx !== -1) {
    const pPrEnd = paraXml.indexOf('</w:pPr>', pPrIdx);
    if (pPrEnd !== -1) {
      const pPr = paraXml.substring(pPrIdx, pPrEnd);
      if (/w:val="[Hh]eading\d*"/.test(pPr)) return true;
      if (pPr.indexOf('w:val="TOC') !== -1) return true;
    }
  }

  // Text-based heading detection with strict rules to avoid matching table values
  // like "1.5 mm", "2.3 bar", "3. 500", etc.
  const text = extractParaText(paraXml).trim();
  if (text.length < 8 || text.length > 120) return false;

  // Pattern: "N. WORD..." — number + period + NOT followed by digit + word starting with letter
  // Matches: "1. DESCRIPTION", "2. SAFETY", "3. SPECIFICATIONS"
  // Excludes: "1.5 mm", "2.3 bar", "3. 500"
  if (/^\d+\.(?!\d)\s+[A-Za-zÀ-ÿ]{2,}/.test(text)) return true;

  // Pattern: "N.N WORD..." — sub-heading like "2.1 General Safety"
  // The text after the number must start with a letter, not a digit or unit
  if (/^\d+\.\d+\.?\s+[A-Za-zÀ-ÿ]{2,}/.test(text) && !/^\d+\.\d+\.?\s+\d/.test(text)) return true;

  return false;
}

/**
 * Split a section into chapters based on heading paragraphs.
 * If no headings found, splits by maxParagraphsPerChapter.
 * Skips the section marker paragraph (e.g. [English]).
 */
export function splitSectionIntoChapters(
  xml: string,
  sectionStartPara: number,
  sectionEndPara: number,
  maxParagraphsPerChapter: number = 50,
): Chapter[] {
  const positions = findParagraphPositions(xml);
  const chapters: Chapter[] = [];

  // Skip the section marker paragraph (e.g. [English])
  const contentStart = sectionStartPara + 1;
  if (contentStart > sectionEndPara || contentStart >= positions.length) return [];

  // Find heading paragraphs in the section (excluding table cells)
  const headingIndices: number[] = [];
  for (let i = contentStart; i <= sectionEndPara && i < positions.length; i++) {
    const paraXml = xml.substring(positions[i].start, positions[i].end);
    if (isHeadingParagraph(paraXml, xml, positions[i].start)) {
      headingIndices.push(i);
    }
  }

  if (headingIndices.length === 0) {
    // No headings — split by max size
    for (let start = contentStart; start <= sectionEndPara; start += maxParagraphsPerChapter) {
      const end = Math.min(start + maxParagraphsPerChapter - 1, sectionEndPara);
      chapters.push({
        title: `Chunk ${chapters.length + 1}`,
        startParaIdx: start,
        endParaIdx: end,
        paragraphCount: end - start + 1,
      });
    }
    return chapters;
  }

  // Content before first heading → "Introduction" chapter
  if (headingIndices[0] > contentStart) {
    chapters.push({
      title: 'Introduction',
      startParaIdx: contentStart,
      endParaIdx: headingIndices[0] - 1,
      paragraphCount: headingIndices[0] - contentStart,
    });
  }

  // Chapters from headings
  for (let h = 0; h < headingIndices.length; h++) {
    const start = headingIndices[h];
    const end = h + 1 < headingIndices.length ? headingIndices[h + 1] - 1 : sectionEndPara;
    const paraXml = xml.substring(positions[start].start, positions[start].end);
    chapters.push({
      title: extractParaText(paraXml).substring(0, 80) || `Chapter ${h + 1}`,
      startParaIdx: start,
      endParaIdx: end,
      paragraphCount: end - start + 1,
    });
  }

  // Split oversized chapters into sub-chunks
  const result: Chapter[] = [];
  for (const ch of chapters) {
    if (ch.paragraphCount <= maxParagraphsPerChapter) {
      result.push(ch);
    } else {
      for (let start = ch.startParaIdx; start <= ch.endParaIdx; start += maxParagraphsPerChapter) {
        const end = Math.min(start + maxParagraphsPerChapter - 1, ch.endParaIdx);
        result.push({
          title: start === ch.startParaIdx ? ch.title : `${ch.title} (cont.)`,
          startParaIdx: start,
          endParaIdx: end,
          paragraphCount: end - start + 1,
        });
      }
    }
  }

  return result;
}

/**
 * Format chapter text as numbered paragraphs for Claude.
 * Format: [N] paragraph text (or [N] (empty) for empty paragraphs)
 */
export function formatChapterText(xml: string, chapter: Chapter): string {
  const positions = findParagraphPositions(xml);
  const lines: string[] = [];

  for (let i = chapter.startParaIdx; i <= chapter.endParaIdx && i < positions.length; i++) {
    const paraXml = xml.substring(positions[i].start, positions[i].end);
    const text = extractParaText(paraXml);
    const num = i - chapter.startParaIdx + 1;
    lines.push(`[${num}] ${text || '(empty)'}`);
  }

  return lines.join('\n');
}

/**
 * Extract plain paragraph texts from formatted chapter text (the [N] format).
 * Returns array of paragraph texts indexed 0-based.
 */
export function extractTextsFromFormat(formattedText: string): string[] {
  const result: string[] = [];
  const lines = formattedText.split('\n');
  for (const line of lines) {
    const match = line.match(/^\[(\d+)\]\s*(.*)/);
    if (match) {
      const text = match[2].trim();
      result.push(text === '(empty)' ? '' : text);
    }
  }
  return result;
}

/**
 * Parse Claude's chapter response into structured paragraph actions.
 *
 * Expected formats:
 * - [N] text              → keep or replace paragraph N
 * - [N] <<DELETED>>       → delete paragraph N
 * - [N+] text             → insert new paragraph after N
 * - [N] (empty)           → empty paragraph (keep as-is)
 */
export function parseChapterResponse(text: string): ParsedParagraph[] {
  const result: ParsedParagraph[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Insert: [N+] text
    const insertMatch = trimmed.match(/^\[(\d+)\+\]\s*(.*)/);
    if (insertMatch) {
      result.push({
        originalIndex: parseInt(insertMatch[1]),
        action: 'insert',
        text: insertMatch[2].trim(),
      });
      continue;
    }

    // Delete: [N] <<DELETED>>
    const deleteMatch = trimmed.match(/^\[(\d+)\]\s*<<DELETED>>/i);
    if (deleteMatch) {
      result.push({
        originalIndex: parseInt(deleteMatch[1]),
        action: 'delete',
        text: '',
      });
      continue;
    }

    // Normal: [N] text
    const normalMatch = trimmed.match(/^\[(\d+)\]\s*(.*)/);
    if (normalMatch) {
      const paraText = normalMatch[2].trim();
      result.push({
        originalIndex: parseInt(normalMatch[1]),
        action: 'keep_or_replace',
        text: paraText === '(empty)' ? '' : paraText,
      });
      continue;
    }
  }

  return result;
}

function normalizeText(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Build SectionModification[] by comparing Claude's chapter response with original target text.
 *
 * @param originalTexts - Original target paragraph texts (0-based array)
 * @param parsed - Parsed response from Claude
 * @param chapterRelStart - Chapter start index relative to section start
 */
export function buildChapterModifications(
  originalTexts: string[],
  parsed: ParsedParagraph[],
  chapterRelStart: number,
): Array<{ relativeParagraphIndex: number; action: 'delete_paragraph' | 'replace_text' | 'insert_after'; newText?: string }> {
  const mods: Array<{ relativeParagraphIndex: number; action: 'delete_paragraph' | 'replace_text' | 'insert_after'; newText?: string }> = [];

  for (const para of parsed) {
    const origIdx = para.originalIndex - 1; // 1-based → 0-based

    switch (para.action) {
      case 'delete':
        if (origIdx >= 0 && origIdx < originalTexts.length) {
          mods.push({
            relativeParagraphIndex: chapterRelStart + origIdx,
            action: 'delete_paragraph',
          });
        }
        break;

      case 'insert':
        if (origIdx >= 0) {
          mods.push({
            relativeParagraphIndex: chapterRelStart + Math.min(origIdx, originalTexts.length - 1),
            action: 'insert_after',
            newText: para.text,
          });
        }
        break;

      case 'keep_or_replace':
        if (origIdx >= 0 && origIdx < originalTexts.length) {
          const origNorm = normalizeText(originalTexts[origIdx]);
          const newNorm = normalizeText(para.text);
          if (origNorm !== newNorm && para.text) {
            mods.push({
              relativeParagraphIndex: chapterRelStart + origIdx,
              action: 'replace_text',
              newText: para.text,
            });
          }
        }
        break;
    }
  }

  return mods;
}
