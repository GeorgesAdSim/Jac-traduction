/**
 * Client-side .docx rebuilder.
 * Takes the original file + modified document.xml and reconstructs the .docx.
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
function findParagraphPositions(xml: string): Array<{ start: number; end: number }> {
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
