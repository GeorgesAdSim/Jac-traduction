/**
 * Split a document section into chapters (groups of paragraphs between headings).
 * Used for chapter-based propagation that avoids the paragraph-index mapping problem
 * between source and target sections with different table structures.
 */

import { findParagraphPositions, extractParaText, findTableRowBoundaries } from './docx-rebuilder';

export interface Chapter {
  title: string;
  startParaIdx: number;   // absolute paragraph index in full XML
  endParaIdx: number;     // absolute paragraph index (inclusive)
  paragraphCount: number;
}

export interface ParsedParagraph {
  originalIndex: number;  // 1-based (from [N] or [TABLE ROW N])
  action: 'keep_or_replace' | 'delete' | 'insert';
  text: string;
  isTableRow?: boolean;
  cellTexts?: string[];
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
      if (/w:val="Titre\d+"/.test(pPr)) return true;
      if (pPr.indexOf('w:val="TOC') !== -1) return true;
      if (pPr.indexOf('w:val="TM') !== -1) return true;
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
 * Result of formatting a chapter with table-row awareness.
 */
export interface ChapterFormatResult {
  text: string;
  /** Maps line number → relative paragraph indices within the chapter */
  lineToRelParaIndices: Map<number, number[]>;
  /** Which line numbers are table rows */
  lineIsTableRow: Set<number>;
  /** For table rows: individual cell texts */
  lineCellTexts: Map<number, string[]>;
  /** Original text for each line (for comparison) */
  lineOrigText: Map<number, string>;
}

/**
 * Format chapter text with table-row awareness.
 * Regular paragraphs: [N] text
 * Table rows: [TABLE ROW N] cell1 | cell2 | cell3
 */
export function formatChapterTextWithTables(xml: string, chapter: Chapter): ChapterFormatResult {
  const positions = findParagraphPositions(xml);
  const trBoundaries = findTableRowBoundaries(xml);

  const lines: string[] = [];
  const lineToRelParaIndices = new Map<number, number[]>();
  const lineIsTableRow = new Set<number>();
  const lineCellTexts = new Map<number, string[]>();
  const lineOrigText = new Map<number, string>();

  let lineNum = 1;
  let i = chapter.startParaIdx;

  while (i <= chapter.endParaIdx && i < positions.length) {
    const paraStart = positions[i].start;

    // Check if this paragraph is inside a table row
    let containingTr: { start: number; end: number } | null = null;
    for (const tr of trBoundaries) {
      if (paraStart >= tr.start && paraStart < tr.end) {
        containingTr = tr;
        break;
      }
    }

    if (!containingTr) {
      // Regular paragraph
      const paraXml = xml.substring(positions[i].start, positions[i].end);
      const text = extractParaText(paraXml);
      lines.push(`[${lineNum}] ${text || '(empty)'}`);
      lineToRelParaIndices.set(lineNum, [i - chapter.startParaIdx]);
      lineOrigText.set(lineNum, text || '');
      lineNum++;
      i++;
    } else {
      // Table row — collect all paragraphs in this <w:tr>
      const rowParaRelIndices: number[] = [];
      const cellTexts: string[] = [];

      while (i <= chapter.endParaIdx && i < positions.length) {
        const ps = positions[i].start;
        if (ps < containingTr.start || ps >= containingTr.end) break;
        const paraXml = xml.substring(positions[i].start, positions[i].end);
        cellTexts.push(extractParaText(paraXml) || '(empty)');
        rowParaRelIndices.push(i - chapter.startParaIdx);
        i++;
      }

      const joined = cellTexts.join(' | ');
      lines.push(`[TABLE ROW ${lineNum}] ${joined}`);
      lineToRelParaIndices.set(lineNum, rowParaRelIndices);
      lineIsTableRow.add(lineNum);
      lineCellTexts.set(lineNum, cellTexts);
      lineOrigText.set(lineNum, joined);
      lineNum++;
    }
  }

  return {
    text: lines.join('\n'),
    lineToRelParaIndices,
    lineIsTableRow,
    lineCellTexts,
    lineOrigText,
  };
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

    // Table row insert: [TABLE ROW N+] cell1 | cell2 | cell3
    const tableInsertMatch = trimmed.match(/^\[TABLE ROW (\d+)\+\]\s*(.*)/i);
    if (tableInsertMatch) {
      const cellTexts = tableInsertMatch[2].split('|').map(c => c.trim());
      result.push({
        originalIndex: parseInt(tableInsertMatch[1]),
        action: 'insert',
        text: tableInsertMatch[2].trim(),
        isTableRow: true,
        cellTexts,
      });
      continue;
    }

    // Table row delete: [TABLE ROW N] <<DELETED>>
    const tableDeleteMatch = trimmed.match(/^\[TABLE ROW (\d+)\]\s*<<DELETED>>/i);
    if (tableDeleteMatch) {
      result.push({
        originalIndex: parseInt(tableDeleteMatch[1]),
        action: 'delete',
        text: '',
        isTableRow: true,
      });
      continue;
    }

    // Table row normal/replace: [TABLE ROW N] cell1 | cell2 | cell3
    const tableNormalMatch = trimmed.match(/^\[TABLE ROW (\d+)\]\s*(.*)/i);
    if (tableNormalMatch) {
      const cellTexts = tableNormalMatch[2].split('|').map(c => c.trim());
      result.push({
        originalIndex: parseInt(tableNormalMatch[1]),
        action: 'keep_or_replace',
        text: tableNormalMatch[2].trim(),
        isTableRow: true,
        cellTexts,
      });
      continue;
    }

    // Regular insert: [N+] text
    const insertMatch = trimmed.match(/^\[(\d+)\+\]\s*(.*)/);
    if (insertMatch) {
      result.push({
        originalIndex: parseInt(insertMatch[1]),
        action: 'insert',
        text: insertMatch[2].trim(),
      });
      continue;
    }

    // Regular delete: [N] <<DELETED>>
    const deleteMatch = trimmed.match(/^\[(\d+)\]\s*<<DELETED>>/i);
    if (deleteMatch) {
      result.push({
        originalIndex: parseInt(deleteMatch[1]),
        action: 'delete',
        text: '',
      });
      continue;
    }

    // Regular normal: [N] text
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

/**
 * Build modifications using table-row-aware format result.
 * Handles both regular paragraphs and TABLE ROW entries.
 */
export function buildChapterModificationsWithTables(
  parsed: ParsedParagraph[],
  chapterRelStart: number,
  formatResult: ChapterFormatResult,
): Array<{ relativeParagraphIndex: number; action: 'delete_paragraph' | 'replace_text' | 'insert_after' | 'delete_table_row' | 'insert_table_row'; newText?: string; cellTexts?: string[] }> {
  type Mod = { relativeParagraphIndex: number; action: 'delete_paragraph' | 'replace_text' | 'insert_after' | 'delete_table_row' | 'insert_table_row'; newText?: string; cellTexts?: string[] };
  const mods: Mod[] = [];

  for (const para of parsed) {
    const lineNum = para.originalIndex;
    const paraIndices = formatResult.lineToRelParaIndices.get(lineNum);
    if (!paraIndices || paraIndices.length === 0) continue;

    if (para.isTableRow) {
      // Table row operations
      switch (para.action) {
        case 'delete':
          // Delete the entire <w:tr> — use first paragraph's index
          mods.push({
            relativeParagraphIndex: chapterRelStart + paraIndices[0],
            action: 'delete_table_row',
          });
          break;

        case 'insert':
          // Insert new <w:tr> after the referenced row — use last paragraph's index
          mods.push({
            relativeParagraphIndex: chapterRelStart + paraIndices[paraIndices.length - 1],
            action: 'insert_table_row',
            cellTexts: para.cellTexts || [para.text],
          });
          break;

        case 'keep_or_replace': {
          // Compare individual cells and replace changed ones
          const origCells = formatResult.lineCellTexts.get(lineNum) || [];
          const newCells = para.cellTexts || [];
          for (let c = 0; c < Math.min(paraIndices.length, newCells.length); c++) {
            const origNorm = normalizeText(origCells[c] || '');
            const newNorm = normalizeText(newCells[c] || '');
            if (origNorm !== newNorm && newCells[c]) {
              mods.push({
                relativeParagraphIndex: chapterRelStart + paraIndices[c],
                action: 'replace_text',
                newText: newCells[c],
              });
            }
          }
          break;
        }
      }
    } else {
      // Regular paragraph operations
      const relIdx = paraIndices[0];
      switch (para.action) {
        case 'delete':
          mods.push({
            relativeParagraphIndex: chapterRelStart + relIdx,
            action: 'delete_paragraph',
          });
          break;

        case 'insert':
          mods.push({
            relativeParagraphIndex: chapterRelStart + relIdx,
            action: 'insert_after',
            newText: para.text,
          });
          break;

        case 'keep_or_replace': {
          const origText = formatResult.lineOrigText.get(lineNum) || '';
          const origNorm = normalizeText(origText);
          const newNorm = normalizeText(para.text);
          if (origNorm !== newNorm && para.text) {
            mods.push({
              relativeParagraphIndex: chapterRelStart + relIdx,
              action: 'replace_text',
              newText: para.text,
            });
          }
          break;
        }
      }
    }
  }

  return mods;
}
