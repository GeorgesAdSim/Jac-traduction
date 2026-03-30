/**
 * Client-side .docx rebuilder.
 * Takes the original file, cleaned source XML, and reconstructs the .docx.
 */

import JSZip from 'jszip';

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

/**
 * Rebuild a .docx file with the modified document.xml.
 */
export async function rebuildDocx(
  originalFile: File,
  cleanedDocumentXml: string,
): Promise<Blob> {
  const buffer = await originalFile.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer, { createFolders: false });

  zip.file('word/document.xml', cleanedDocumentXml);

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return blob;
}

/**
 * Replace paragraphs in a range with new paragraph XML content.
 */
export function replaceParagraphsInXml(
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

/**
 * Get the raw XML of paragraphs in a range.
 */
export function getParagraphsXml(
  fullXml: string,
  startPara: number,
  endPara: number
): string {
  const { paragraphs } = splitIntoParagraphs(fullXml);
  return paragraphs.slice(startPara, endPara + 1).join('');
}

/**
 * Get text content of paragraphs in a range.
 */
export function getParagraphTexts(
  fullXml: string,
  startPara: number,
  endPara: number
): string[] {
  const { paragraphs } = splitIntoParagraphs(fullXml);
  return paragraphs.slice(startPara, endPara + 1).map((p) => {
    const texts: string[] = [];
    const tRegex = /<[^>]*:t[^>]*>([\s\S]*?)<\/[^>]*:t>/g;
    let match;
    while ((match = tRegex.exec(p)) !== null) {
      texts.push(match[1]);
    }
    return texts.join('');
  });
}
