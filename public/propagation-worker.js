/**
 * Web Worker for heavy XML processing during propagation.
 * Runs in a separate thread to prevent browser freeze on large DOCX files.
 *
 * All functions are self-contained (no imports) — copied from:
 * - lib/docx-rebuilder.ts
 * - lib/docx-source-cleaner.ts
 * - lib/docx-chapter-splitter.ts
 */

/* eslint-disable no-restricted-globals */

// ── Caches (keyed by xml.length — different XMLs have different lengths) ─────

var _paraCache = {};
var _trCache = {};

function findParagraphPositionsCached(xml) {
  var key = xml.length;
  if (_paraCache[key]) return _paraCache[key];
  self.postMessage({ type: 'progress', step: 'Scan', detail: 'Scan des paragraphes (' + Math.round(xml.length / 1024 / 1024 * 10) / 10 + ' Mo)...' });
  var result = findParagraphPositions(xml);
  self.postMessage({ type: 'progress', step: 'Scan', detail: result.length + ' paragraphes trouvés' });
  _paraCache[key] = result;
  return result;
}

function findTableRowBoundariesCached(xml) {
  var key = xml.length;
  if (_trCache[key]) return _trCache[key];
  self.postMessage({ type: 'progress', step: 'Scan', detail: 'Scan des lignes de tableau...' });
  var result = findTableRowBoundaries(xml);
  self.postMessage({ type: 'progress', step: 'Scan', detail: result.length + ' lignes de tableau trouvées' });
  _trCache[key] = result;
  return result;
}

// ── Paragraph positions ──────────────────────────────────────────

function findParagraphPositions(xml) {
  var positions = [];
  var searchFrom = 0;
  var xmlLen = xml.length;
  while (searchFrom < xmlLen) {
    var openIdx = xml.indexOf('<w:p', searchFrom);
    if (openIdx === -1) break;
    var c = xml.charCodeAt(openIdx + 4);
    // '>' = 62, ' ' = 32 — skip <w:pPr, <w:pStyle etc.
    if (c !== 62 && c !== 32) { searchFrom = openIdx + 4; continue; }
    // In valid OOXML, <w:p> never nests inside <w:p> — just find the NEXT </w:p>
    var closeIdx = xml.indexOf('</w:p>', openIdx + 4);
    if (closeIdx === -1) break;
    positions.push({ start: openIdx, end: closeIdx + 6 });
    searchFrom = closeIdx + 6;
  }
  return positions;
}

function extractParaText(paraXml) {
  var texts = [];
  var openTag = '<w:t';
  var closeTag = '</w:t>';
  var pos = 0;

  while (pos < paraXml.length) {
    var openIdx = paraXml.indexOf(openTag, pos);
    if (openIdx === -1) break;
    var tagEnd = paraXml.indexOf('>', openIdx);
    if (tagEnd === -1) break;
    var closeIdx = paraXml.indexOf(closeTag, tagEnd + 1);
    if (closeIdx === -1) break;
    texts.push(paraXml.substring(tagEnd + 1, closeIdx));
    pos = closeIdx + closeTag.length;
  }

  return texts.join('');
}

function findTableRowBoundaries(xml) {
  var rows = [];
  var pos = 0;
  while (pos < xml.length) {
    var openIdx = xml.indexOf('<w:tr', pos);
    if (openIdx === -1) break;
    var charAfter = xml[openIdx + 5];
    if (charAfter !== '>' && charAfter !== ' ') {
      pos = openIdx + 5;
      continue;
    }
    var closeIdx = xml.indexOf('</w:tr>', openIdx);
    if (closeIdx === -1) break;
    rows.push({ start: openIdx, end: closeIdx + 7 });
    pos = closeIdx + 7;
  }
  return rows;
}

// ── Section detection ──────────────────────────────────────────

var LANG_MARKERS = {
  english: 'EN', 'français': 'FR', deutsch: 'DE', nederlands: 'NL',
  'русский': 'RU', 'español': 'ES', italiano: 'IT', 'العربية': 'AR',
  polski: 'PL', 'português': 'PT', 'česky': 'CS', magyar: 'HU',
  'română': 'RO', 'türkçe': 'TR',
};

function detectSectionsInRawXml(xml) {
  var positions = findParagraphPositionsCached(xml);
  var markers = [];

  for (var i = 0; i < positions.length; i++) {
    var paraXml = xml.substring(positions[i].start, positions[i].end);
    var text = extractParaText(paraXml).trim();
    if (!text) continue;

    var cleaned = text.replace(/^\[\s*/, '').replace(/\s*\]$/, '').trim().toLowerCase();
    var lang = LANG_MARKERS[cleaned];
    if (lang && !markers.some(function(m) { return m.lang === lang; })) {
      markers.push({ index: i, lang: lang });
    }
  }

  if (markers.length === 0) return [];
  markers.sort(function(a, b) { return a.index - b.index; });

  var sections = [];
  for (var j = 0; j < markers.length; j++) {
    var start = markers[j].index;
    var end = j + 1 < markers.length ? markers[j + 1].index - 1 : positions.length - 1;
    sections.push({ lang: markers[j].lang, startPara: start, endPara: end });
  }
  return sections;
}

// ── Source cleaner ──────────────────────────────────────────

function highlightToType(val) {
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

function findRunPositions(paraXml) {
  var positions = [];
  var openTag = '<w:r';
  var closeTag = '</w:r>';
  var searchFrom = 0;

  while (searchFrom < paraXml.length) {
    var openIdx = paraXml.indexOf(openTag, searchFrom);
    if (openIdx === -1) break;
    var charAfter = paraXml[openIdx + openTag.length];
    if (charAfter !== '>' && charAfter !== ' ') {
      searchFrom = openIdx + openTag.length;
      continue;
    }
    var closeIdx = paraXml.indexOf(closeTag, openIdx);
    if (closeIdx === -1) break;
    positions.push({ start: openIdx, end: closeIdx + closeTag.length });
    searchFrom = closeIdx + closeTag.length;
  }
  return positions;
}

function getRunHighlight(runXml) {
  var idx = runXml.indexOf('<w:highlight');
  if (idx === -1) return null;
  var valIdx = runXml.indexOf('w:val="', idx);
  if (valIdx === -1) return null;
  var valStart = valIdx + 7;
  var valEnd = runXml.indexOf('"', valStart);
  if (valEnd === -1) return null;
  var val = runXml.substring(valStart, valEnd);
  return val !== 'none' ? val : null;
}

function getParagraphHighlight(paraXml) {
  var pPrIdx = paraXml.indexOf('<w:pPr');
  if (pPrIdx === -1) return null;
  var pPrEnd = paraXml.indexOf('</w:pPr>', pPrIdx);
  if (pPrEnd === -1) return null;
  var pPrContent = paraXml.substring(pPrIdx, pPrEnd);
  var rPrIdx = pPrContent.indexOf('<w:rPr');
  if (rPrIdx === -1) return null;
  var rPrEnd = pPrContent.indexOf('</w:rPr>', rPrIdx);
  if (rPrEnd === -1) return null;
  return getRunHighlight(pPrContent.substring(rPrIdx, rPrEnd));
}

function removeHighlight(xml) {
  var result = xml;
  var idx = result.indexOf('<w:highlight');
  while (idx !== -1) {
    var selfClose = result.indexOf('/>', idx);
    var openClose = result.indexOf('>', idx);
    if (selfClose !== -1 && selfClose <= openClose + 1) {
      result = result.substring(0, idx) + result.substring(selfClose + 2);
    } else {
      var endTag = result.indexOf('</w:highlight>', idx);
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

function cleanSourceSection(fullXml, sourceStartPara, sourceEndPara, mode) {
  var paraPositions = findParagraphPositionsCached(fullXml);
  var modifications = [];
  var replacements = [];

  for (var pIdx = sourceStartPara; pIdx <= sourceEndPara && pIdx < paraPositions.length; pIdx++) {
    var paraStart = paraPositions[pIdx].start;
    var paraEnd = paraPositions[pIdx].end;
    var paraXml = fullXml.substring(paraStart, paraEnd);

    var paraHighlight = getParagraphHighlight(paraXml);
    var runPositions = findRunPositions(paraXml);
    if (runPositions.length === 0 && !paraHighlight) continue;

    if (runPositions.length === 0 && paraHighlight) {
      var modType = highlightToType(paraHighlight);
      if (modType === 'NONE') continue;

      var text = extractParaText(paraXml);
      var contextBefore = pIdx > 0
        ? extractParaText(fullXml.substring(paraPositions[pIdx - 1].start, paraPositions[pIdx - 1].end))
        : '';
      var contextAfter = pIdx < paraPositions.length - 1
        ? extractParaText(fullXml.substring(paraPositions[pIdx + 1].start, paraPositions[pIdx + 1].end))
        : '';

      modifications.push({
        type: modType,
        text: text,
        paragraphIndex: pIdx - sourceStartPara,
        contextBefore: contextBefore,
        contextAfter: contextAfter,
        paragraphDeleted: modType === 'DELETE',
      });

      var shouldRemovePara = mode === 'before' ? modType === 'ADD' : modType === 'DELETE';
      if (shouldRemovePara) {
        replacements.push({ start: paraStart, end: paraEnd, newXml: '' });
      } else {
        replacements.push({ start: paraStart, end: paraEnd, newXml: removeHighlight(paraXml) });
      }
      continue;
    }

    var hasChanges = false;
    var parts = [];

    for (var r = 0; r < runPositions.length; r++) {
      var runPos = runPositions[r];
      var runXml = paraXml.substring(runPos.start, runPos.end);
      var highlight = getRunHighlight(runXml) || paraHighlight;
      if (!highlight) continue;

      var runModType = highlightToType(highlight);
      if (runModType === 'NONE') continue;

      hasChanges = true;
      var runText = extractParaText(runXml);
      var ctxBefore = pIdx > 0
        ? extractParaText(fullXml.substring(paraPositions[pIdx - 1].start, paraPositions[pIdx - 1].end))
        : '';
      var ctxAfter = pIdx < paraPositions.length - 1
        ? extractParaText(fullXml.substring(paraPositions[pIdx + 1].start, paraPositions[pIdx + 1].end))
        : '';

      var shouldRemoveRun = mode === 'before' ? runModType === 'ADD' : runModType === 'DELETE';
      if (shouldRemoveRun) {
        parts.push({ start: runPos.start, end: runPos.end, replacement: null });
      } else {
        parts.push({ start: runPos.start, end: runPos.end, replacement: removeHighlight(runXml) });
      }
      modifications.push({
        type: runModType,
        text: runText,
        paragraphIndex: pIdx - sourceStartPara,
        contextBefore: ctxBefore,
        contextAfter: ctxAfter,
        paragraphDeleted: false,
      });
    }

    if (!hasChanges) continue;

    var removeType = mode === 'before' ? 'ADD' : 'DELETE';
    var allRunsRemoved = runPositions.length > 0 && runPositions.every(function(rp) {
      var rx = paraXml.substring(rp.start, rp.end);
      var hl = getRunHighlight(rx) || paraHighlight;
      if (!hl) {
        var t = extractParaText(rx).trim();
        return t === '';
      }
      return highlightToType(hl) === removeType;
    });

    if (allRunsRemoved) {
      for (var m = 0; m < modifications.length; m++) {
        if (modifications[m].paragraphIndex === pIdx - sourceStartPara && modifications[m].type === removeType) {
          modifications[m].paragraphDeleted = true;
        }
      }
      replacements.push({ start: paraStart, end: paraEnd, newXml: '' });
      continue;
    }

    var newParaXml = paraXml;
    for (var ri = parts.length - 1; ri >= 0; ri--) {
      var part = parts[ri];
      if (part.replacement === null) {
        newParaXml = newParaXml.substring(0, part.start) + newParaXml.substring(part.end);
      } else {
        newParaXml = newParaXml.substring(0, part.start) + part.replacement + newParaXml.substring(part.end);
      }
    }

    if (paraHighlight) {
      newParaXml = removeHighlight(newParaXml);
    }

    replacements.push({ start: paraStart, end: paraEnd, newXml: newParaXml });
  }

  if (replacements.length === 0) {
    return { cleanedXml: fullXml, modifications: modifications };
  }

  var resultParts = [];
  var lastEnd = 0;
  for (var k = 0; k < replacements.length; k++) {
    resultParts.push(fullXml.substring(lastEnd, replacements[k].start));
    resultParts.push(replacements[k].newXml);
    lastEnd = replacements[k].end;
  }
  resultParts.push(fullXml.substring(lastEnd));

  return { cleanedXml: resultParts.join(''), modifications: modifications };
}

// ── Chapter splitter ──────────────────────────────────────────

function isInsideTable(xml, paraStart) {
  var lookback = xml.substring(Math.max(0, paraStart - 5000), paraStart);
  var depth = 0;
  var pos = 0;
  while (pos < lookback.length) {
    var nextOpen = lookback.indexOf('<w:tc', pos);
    var nextClose = lookback.indexOf('</w:tc>', pos);
    if (nextOpen === -1 && nextClose === -1) break;
    if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
      var charAfter = lookback[nextOpen + 5];
      if (charAfter === '>' || charAfter === ' ') depth++;
      pos = nextOpen + 5;
    } else {
      depth = Math.max(0, depth - 1);
      pos = nextClose + 7;
    }
  }
  return depth > 0;
}

function isHeadingParagraph(paraXml, xml, paraStart) {
  if (xml && paraStart !== undefined && isInsideTable(xml, paraStart)) {
    return false;
  }

  var pPrIdx = paraXml.indexOf('<w:pPr');
  if (pPrIdx !== -1) {
    var pPrEnd = paraXml.indexOf('</w:pPr>', pPrIdx);
    if (pPrEnd !== -1) {
      var pPr = paraXml.substring(pPrIdx, pPrEnd);
      // Match English "Heading1", French "Titre1"/"Titre2", and TOC styles
      if (/w:val="[Hh]eading\d*"/.test(pPr)) return true;
      if (/w:val="Titre\d+"/.test(pPr)) return true;
      if (pPr.indexOf('w:val="TOC') !== -1) return true;
      if (pPr.indexOf('w:val="TM') !== -1) return true;
    }
  }

  var text = extractParaText(paraXml).trim();
  if (text.length < 8 || text.length > 120) return false;

  if (/^\d+\.(?!\d)\s+[A-Za-z\u00C0-\u024F]{2,}/.test(text)) return true;
  if (/^\d+\.\d+\.?\s+[A-Za-z\u00C0-\u024F]{2,}/.test(text) && !/^\d+\.\d+\.?\s+\d/.test(text)) return true;

  return false;
}

function splitSectionIntoChapters(xml, sectionStartPara, sectionEndPara, maxParagraphsPerChapter) {
  maxParagraphsPerChapter = maxParagraphsPerChapter || 50;
  var positions = findParagraphPositionsCached(xml);
  var chapters = [];

  var contentStart = sectionStartPara + 1;
  if (contentStart > sectionEndPara || contentStart >= positions.length) return [];

  var headingIndices = [];
  for (var i = contentStart; i <= sectionEndPara && i < positions.length; i++) {
    var paraXml = xml.substring(positions[i].start, positions[i].end);
    if (isHeadingParagraph(paraXml, xml, positions[i].start)) {
      headingIndices.push(i);
    }
  }

  if (headingIndices.length === 0) {
    for (var start = contentStart; start <= sectionEndPara; start += maxParagraphsPerChapter) {
      var end = Math.min(start + maxParagraphsPerChapter - 1, sectionEndPara);
      chapters.push({
        title: 'Chunk ' + (chapters.length + 1),
        startParaIdx: start,
        endParaIdx: end,
        paragraphCount: end - start + 1,
      });
    }
    return chapters;
  }

  if (headingIndices[0] > contentStart) {
    chapters.push({
      title: 'Introduction',
      startParaIdx: contentStart,
      endParaIdx: headingIndices[0] - 1,
      paragraphCount: headingIndices[0] - contentStart,
    });
  }

  for (var h = 0; h < headingIndices.length; h++) {
    var hStart = headingIndices[h];
    var hEnd = h + 1 < headingIndices.length ? headingIndices[h + 1] - 1 : sectionEndPara;
    var hParaXml = xml.substring(positions[hStart].start, positions[hStart].end);
    chapters.push({
      title: extractParaText(hParaXml).substring(0, 80) || ('Chapter ' + (h + 1)),
      startParaIdx: hStart,
      endParaIdx: hEnd,
      paragraphCount: hEnd - hStart + 1,
    });
  }

  var result = [];
  for (var c = 0; c < chapters.length; c++) {
    var ch = chapters[c];
    if (ch.paragraphCount <= maxParagraphsPerChapter) {
      result.push(ch);
    } else {
      for (var s = ch.startParaIdx; s <= ch.endParaIdx; s += maxParagraphsPerChapter) {
        var e = Math.min(s + maxParagraphsPerChapter - 1, ch.endParaIdx);
        result.push({
          title: s === ch.startParaIdx ? ch.title : ch.title + ' (cont.)',
          startParaIdx: s,
          endParaIdx: e,
          paragraphCount: e - s + 1,
        });
      }
    }
  }

  return result;
}

function formatChapterText(xml, chapter) {
  var positions = findParagraphPositionsCached(xml);
  var lines = [];

  for (var i = chapter.startParaIdx; i <= chapter.endParaIdx && i < positions.length; i++) {
    var paraXml = xml.substring(positions[i].start, positions[i].end);
    var text = extractParaText(paraXml);
    var num = i - chapter.startParaIdx + 1;
    lines.push('[' + num + '] ' + (text || '(empty)'));
  }

  return lines.join('\n');
}

function formatChapterTextWithTables(xml, chapter) {
  var positions = findParagraphPositionsCached(xml);
  var trBoundaries = findTableRowBoundariesCached(xml);

  var lines = [];
  // Use plain objects + arrays instead of Map/Set for serialization
  var lineToRelParaIndices = {};
  var lineIsTableRow = {};
  var lineCellTexts = {};
  var lineOrigText = {};

  var lineNum = 1;
  var i = chapter.startParaIdx;

  while (i <= chapter.endParaIdx && i < positions.length) {
    var paraStart = positions[i].start;

    var containingTr = null;
    for (var t = 0; t < trBoundaries.length; t++) {
      if (paraStart >= trBoundaries[t].start && paraStart < trBoundaries[t].end) {
        containingTr = trBoundaries[t];
        break;
      }
    }

    if (!containingTr) {
      var paraXml = xml.substring(positions[i].start, positions[i].end);
      var text = extractParaText(paraXml);
      lines.push('[' + lineNum + '] ' + (text || '(empty)'));
      lineToRelParaIndices[lineNum] = [i - chapter.startParaIdx];
      lineOrigText[lineNum] = text || '';
      lineNum++;
      i++;
    } else {
      var rowParaRelIndices = [];
      var cellTexts = [];

      while (i <= chapter.endParaIdx && i < positions.length) {
        var ps = positions[i].start;
        if (ps < containingTr.start || ps >= containingTr.end) break;
        var pXml = xml.substring(positions[i].start, positions[i].end);
        cellTexts.push(extractParaText(pXml) || '(empty)');
        rowParaRelIndices.push(i - chapter.startParaIdx);
        i++;
      }

      var joined = cellTexts.join(' | ');
      lines.push('[TABLE ROW ' + lineNum + '] ' + joined);
      lineToRelParaIndices[lineNum] = rowParaRelIndices;
      lineIsTableRow[lineNum] = true;
      lineCellTexts[lineNum] = cellTexts;
      lineOrigText[lineNum] = joined;
      lineNum++;
    }
  }

  return {
    text: lines.join('\n'),
    lineToRelParaIndices: lineToRelParaIndices,
    lineIsTableRow: lineIsTableRow,
    lineCellTexts: lineCellTexts,
    lineOrigText: lineOrigText,
  };
}

// ── XML modification functions (from docx-rebuilder.ts) ─────────

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function replaceInWt(paraXml, searchText, replaceText) {
  var wtPositions = [];
  var pos = 0;
  while (pos < paraXml.length) {
    var openIdx = paraXml.indexOf('<w:t', pos);
    if (openIdx === -1) break;
    var tagEnd = paraXml.indexOf('>', openIdx);
    if (tagEnd === -1) break;
    var closeIdx = paraXml.indexOf('</w:t>', tagEnd + 1);
    if (closeIdx === -1) break;
    wtPositions.push({
      tagStart: openIdx, textStart: tagEnd + 1, textEnd: closeIdx,
      closeEnd: closeIdx + 6, text: paraXml.substring(tagEnd + 1, closeIdx),
    });
    pos = closeIdx + 6;
  }
  if (wtPositions.length === 0) return paraXml;
  var fullText = wtPositions.map(function(w) { return w.text; }).join('');
  var searchIdx = fullText.indexOf(searchText);
  if (searchIdx === -1) return paraXml;
  var newFullText = fullText.substring(0, searchIdx) + replaceText + fullText.substring(searchIdx + searchText.length);
  var result = paraXml;
  for (var i = wtPositions.length - 1; i >= 0; i--) {
    var wt = wtPositions[i];
    if (i === 0) {
      result = result.substring(0, wt.textStart) + newFullText + result.substring(wt.textEnd);
    } else {
      result = result.substring(0, wt.textStart) + result.substring(wt.textEnd);
    }
  }
  return result;
}

function buildNewTableRow(refRowXml, cells) {
  var trPr = '';
  var trPrStart = refRowXml.indexOf('<w:trPr');
  if (trPrStart !== -1) {
    var trPrEnd = refRowXml.indexOf('</w:trPr>', trPrStart);
    if (trPrEnd !== -1) trPr = refRowXml.substring(trPrStart, trPrEnd + 9);
  }
  var tcPrs = [];
  var tcScan = 0;
  while (tcScan < refRowXml.length) {
    var tcPrStart = refRowXml.indexOf('<w:tcPr', tcScan);
    if (tcPrStart === -1) break;
    var tcPrEnd = refRowXml.indexOf('</w:tcPr>', tcPrStart);
    if (tcPrEnd === -1) break;
    tcPrs.push(refRowXml.substring(tcPrStart, tcPrEnd + 9));
    tcScan = tcPrEnd + 9;
  }
  var cellsXml = cells.map(function(t, idx) {
    var tcPr = idx < tcPrs.length ? tcPrs[idx] : '';
    return '<w:tc>' + tcPr + '<w:p><w:r><w:t xml:space="preserve">' + escapeXml(t) + '</w:t></w:r></w:p></w:tc>';
  }).join('');
  return '<w:tr>' + trPr + cellsXml + '</w:tr>';
}

function applyModificationsToSection(xml, sectionStartPara, modifications) {
  if (modifications.length === 0) return xml;
  var positions = findParagraphPositionsCached(xml);
  var trBoundaries = findTableRowBoundariesCached(xml);
  var edits = [];

  for (var mi = 0; mi < modifications.length; mi++) {
    var mod = modifications[mi];
    var absIdx = sectionStartPara + mod.relativeParagraphIndex;
    if (absIdx < 0 || absIdx >= positions.length) {
      if (mod.action === 'insert_after' && absIdx === positions.length && positions.length > 0) {
        var lastPos = positions[positions.length - 1];
        edits.push({ start: lastPos.end, end: lastPos.end,
          replacement: '<w:p><w:r><w:t xml:space="preserve">' + escapeXml(mod.newText || '') + '</w:t></w:r></w:p>' });
      }
      continue;
    }
    var pStart = positions[absIdx].start;
    var pEnd = positions[absIdx].end;

    switch (mod.action) {
      case 'delete_paragraph':
        edits.push({ start: pStart, end: pEnd, replacement: '' });
        break;
      case 'replace_text':
        if (!mod.newText) break;
        var paraXml = xml.substring(pStart, pEnd);
        var fullText = extractParaText(paraXml);
        if (fullText) {
          edits.push({ start: pStart, end: pEnd, replacement: replaceInWt(paraXml, fullText, mod.newText) });
        } else {
          edits.push({ start: pStart, end: pEnd,
            replacement: '<w:p><w:r><w:t xml:space="preserve">' + escapeXml(mod.newText) + '</w:t></w:r></w:p>' });
        }
        break;
      case 'insert_after':
        if (!mod.newText) break;
        edits.push({ start: pEnd, end: pEnd,
          replacement: '<w:p><w:r><w:t xml:space="preserve">' + escapeXml(mod.newText) + '</w:t></w:r></w:p>' });
        break;
      case 'delete_table_row':
        for (var tri = 0; tri < trBoundaries.length; tri++) {
          if (pStart >= trBoundaries[tri].start && pStart < trBoundaries[tri].end) {
            edits.push({ start: trBoundaries[tri].start, end: trBoundaries[tri].end, replacement: '' });
            break;
          }
        }
        break;
      case 'insert_table_row':
        for (var trj = 0; trj < trBoundaries.length; trj++) {
          if (pStart >= trBoundaries[trj].start && pStart < trBoundaries[trj].end) {
            var refRowXml = xml.substring(trBoundaries[trj].start, trBoundaries[trj].end);
            var cells = mod.cellTexts || [mod.newText || ''];
            edits.push({ start: trBoundaries[trj].end, end: trBoundaries[trj].end, replacement: buildNewTableRow(refRowXml, cells) });
            break;
          }
        }
        break;
    }
  }

  if (edits.length === 0) return xml;
  edits.sort(function(a, b) { return a.start - b.start || b.end - a.end; });

  var parts = [];
  var lastEnd = 0;
  for (var ei = 0; ei < edits.length; ei++) {
    if (edits[ei].start < lastEnd) continue;
    parts.push(xml.substring(lastEnd, edits[ei].start));
    parts.push(edits[ei].replacement);
    lastEnd = Math.max(lastEnd, edits[ei].end);
  }
  parts.push(xml.substring(lastEnd));

  // Invalidate caches since XML changed
  var key = xml.length;
  delete _paraCache[key];
  delete _trCache[key];

  return parts.join('');
}

// ── Response parsing (from docx-chapter-splitter.ts) ─────────

function parseChapterResponse(text) {
  var result = [];
  var lines = text.split('\n');
  for (var li = 0; li < lines.length; li++) {
    var trimmed = lines[li].trim();
    if (!trimmed) continue;

    var tableInsertMatch = trimmed.match(/^\[TABLE ROW (\d+)\+\]\s*(.*)/i);
    if (tableInsertMatch) {
      result.push({ originalIndex: parseInt(tableInsertMatch[1]), action: 'insert',
        text: tableInsertMatch[2].trim(), isTableRow: true,
        cellTexts: tableInsertMatch[2].split('|').map(function(c) { return c.trim(); }) });
      continue;
    }
    var tableDeleteMatch = trimmed.match(/^\[TABLE ROW (\d+)\]\s*<<DELETED>>/i);
    if (tableDeleteMatch) {
      result.push({ originalIndex: parseInt(tableDeleteMatch[1]), action: 'delete', text: '', isTableRow: true });
      continue;
    }
    var tableNormalMatch = trimmed.match(/^\[TABLE ROW (\d+)\]\s*(.*)/i);
    if (tableNormalMatch) {
      result.push({ originalIndex: parseInt(tableNormalMatch[1]), action: 'keep_or_replace',
        text: tableNormalMatch[2].trim(), isTableRow: true,
        cellTexts: tableNormalMatch[2].split('|').map(function(c) { return c.trim(); }) });
      continue;
    }
    var insertMatch = trimmed.match(/^\[(\d+)\+\]\s*(.*)/);
    if (insertMatch) {
      result.push({ originalIndex: parseInt(insertMatch[1]), action: 'insert', text: insertMatch[2].trim() });
      continue;
    }
    var deleteMatch = trimmed.match(/^\[(\d+)\]\s*<<DELETED>>/i);
    if (deleteMatch) {
      result.push({ originalIndex: parseInt(deleteMatch[1]), action: 'delete', text: '' });
      continue;
    }
    var normalMatch = trimmed.match(/^\[(\d+)\]\s*(.*)/);
    if (normalMatch) {
      var paraText = normalMatch[2].trim();
      result.push({ originalIndex: parseInt(normalMatch[1]), action: 'keep_or_replace',
        text: paraText === '(empty)' ? '' : paraText });
      continue;
    }
  }
  return result;
}

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function buildChapterModificationsWithTables(parsed, chapterRelStart, formatResult) {
  var mods = [];
  for (var pi = 0; pi < parsed.length; pi++) {
    var para = parsed[pi];
    var lineNum = para.originalIndex;
    var paraIndices = formatResult.lineToRelParaIndices[lineNum];
    if (!paraIndices || paraIndices.length === 0) continue;

    if (para.isTableRow) {
      switch (para.action) {
        case 'delete':
          mods.push({ relativeParagraphIndex: chapterRelStart + paraIndices[0], action: 'delete_table_row' });
          break;
        case 'insert':
          mods.push({ relativeParagraphIndex: chapterRelStart + paraIndices[paraIndices.length - 1],
            action: 'insert_table_row', cellTexts: para.cellTexts || [para.text] });
          break;
        case 'keep_or_replace':
          var origCells = formatResult.lineCellTexts[lineNum] || [];
          var newCells = para.cellTexts || [];
          for (var c = 0; c < Math.min(paraIndices.length, newCells.length); c++) {
            if (normalizeText(origCells[c] || '') !== normalizeText(newCells[c] || '') && newCells[c]) {
              mods.push({ relativeParagraphIndex: chapterRelStart + paraIndices[c], action: 'replace_text', newText: newCells[c] });
            }
          }
          break;
      }
    } else {
      var relIdx = paraIndices[0];
      switch (para.action) {
        case 'delete':
          mods.push({ relativeParagraphIndex: chapterRelStart + relIdx, action: 'delete_paragraph' });
          break;
        case 'insert':
          mods.push({ relativeParagraphIndex: chapterRelStart + relIdx, action: 'insert_after', newText: para.text });
          break;
        case 'keep_or_replace':
          var origText = formatResult.lineOrigText[lineNum] || '';
          if (normalizeText(origText) !== normalizeText(para.text) && para.text) {
            mods.push({ relativeParagraphIndex: chapterRelStart + relIdx, action: 'replace_text', newText: para.text });
          }
          break;
      }
    }
  }
  return mods;
}

// ── Worker state (kept between messages) ─────────────────────

var _workerState = null;

// ── Worker message handler ──────────────────────────────────────

self.onmessage = function(e) {
  var data = e.data;

  if (data.type === 'prepare') {
    handlePrepare(data);
  } else if (data.type === 'format-target') {
    handleFormatTarget(data);
  } else if (data.type === 'apply-chapter') {
    handleApplyChapter(data);
  } else if (data.type === 'apply-lang-done') {
    handleApplyLangDone(data);
  } else if (data.type === 'get-final-xml') {
    handleGetFinalXml();
  } else {
    self.postMessage({ type: 'error', message: 'Unknown message type: ' + data.type });
  }
};

function handlePrepare(data) {
  try {
    var xml = data.xml;
    var sourceLang = data.sourceLang;

    self.postMessage({ type: 'progress', step: 'Détection', detail: 'Détection des sections...' });

    var rawSections = detectSectionsInRawXml(xml);
    var rawSourceSection = null;
    for (var s = 0; s < rawSections.length; s++) {
      if (rawSections[s].lang === sourceLang) { rawSourceSection = rawSections[s]; break; }
    }
    if (!rawSourceSection) {
      self.postMessage({ type: 'error', message: 'Section source ' + sourceLang + ' introuvable' });
      return;
    }

    self.postMessage({ type: 'progress', step: 'Source', detail: 'Section ' + sourceLang + ' : paras ' + rawSourceSection.startPara + '-' + rawSourceSection.endPara });

    self.postMessage({ type: 'progress', step: 'Nettoyage', detail: 'Nettoyage after (suppression rouge, garder vert)...' });
    var afterResult = cleanSourceSection(xml, rawSourceSection.startPara, rawSourceSection.endPara, 'after');
    var cleanedXml = afterResult.cleanedXml;
    var appliedMods = afterResult.modifications;

    self.postMessage({ type: 'progress', step: 'Nettoyage', detail: 'Nettoyage before (suppression vert, garder rouge)...' });
    var beforeResult = cleanSourceSection(xml, rawSourceSection.startPara, rawSourceSection.endPara, 'before');
    var beforeXml = beforeResult.cleanedXml;

    self.postMessage({ type: 'progress', step: 'Modifications', detail: appliedMods.length + ' modifications détectées' });

    self.postMessage({ type: 'progress', step: 'Chapitres', detail: 'Découpage en chapitres...' });
    var beforeSections = detectSectionsInRawXml(beforeXml);
    var beforeSourceSection = null;
    for (var bs = 0; bs < beforeSections.length; bs++) {
      if (beforeSections[bs].lang === sourceLang) { beforeSourceSection = beforeSections[bs]; break; }
    }
    if (!beforeSourceSection) {
      self.postMessage({ type: 'error', message: 'Section source "avant" introuvable' });
      return;
    }
    var sourceBeforeChapters = splitSectionIntoChapters(beforeXml, beforeSourceSection.startPara, beforeSourceSection.endPara);

    var newSections = detectSectionsInRawXml(cleanedXml);
    var cleanedSource = null;
    for (var ns = 0; ns < newSections.length; ns++) {
      if (newSections[ns].lang === sourceLang) { cleanedSource = newSections[ns]; break; }
    }
    if (!cleanedSource) {
      self.postMessage({ type: 'error', message: 'Section source nettoyée introuvable' });
      return;
    }
    var sourceAfterChapters = splitSectionIntoChapters(cleanedXml, cleanedSource.startPara, cleanedSource.endPara);

    self.postMessage({ type: 'progress', step: 'Chapitres', detail: 'Source AVANT : ' + sourceBeforeChapters.length + ' chapitres, APRÈS : ' + sourceAfterChapters.length + ' chapitres' });

    self.postMessage({ type: 'progress', step: 'Comparaison', detail: 'Comparaison des chapitres avant/après...' });
    var maxChapters = Math.min(sourceBeforeChapters.length, sourceAfterChapters.length);
    var sourceBeforeTableTexts = [];
    var sourceAfterTableTexts = [];
    var changedChapterIndices = [];
    var chapterLogs = [];

    for (var ci = 0; ci < maxChapters; ci++) {
      var bText = formatChapterText(beforeXml, sourceBeforeChapters[ci]);
      var aText = formatChapterText(cleanedXml, sourceAfterChapters[ci]);
      sourceBeforeTableTexts.push(formatChapterTextWithTables(beforeXml, sourceBeforeChapters[ci]).text);
      sourceAfterTableTexts.push(formatChapterTextWithTables(cleanedXml, sourceAfterChapters[ci]).text);

      var beforeNorm = bText.replace(/\s+/g, ' ').trim();
      var afterNorm = aText.replace(/\s+/g, ' ').trim();
      var beforeLineCount = bText.split('\n').filter(function(l) { return l.trim(); }).length;
      var afterLineCount = aText.split('\n').filter(function(l) { return l.trim(); }).length;
      var isChanged = beforeNorm !== afterNorm || beforeLineCount !== afterLineCount;
      if (isChanged) changedChapterIndices.push(ci);

      chapterLogs.push({
        index: ci, title: sourceAfterChapters[ci].title.substring(0, 40),
        beforeLines: beforeLineCount, afterLines: afterLineCount,
        isChanged: isChanged,
        snippet: !isChanged ? aText.substring(0, 80).replace(/\n/g, ' | ') : '',
      });
    }

    self.postMessage({ type: 'progress', step: 'Comparaison', detail: 'Chapitres modifiés : ' + changedChapterIndices.length + '/' + maxChapters });

    // Store state in worker — do NOT send large XML strings back
    _workerState = {
      currentXml: cleanedXml,
      sourceLang: sourceLang,
      sourceBeforeTableTexts: sourceBeforeTableTexts,
      sourceAfterTableTexts: sourceAfterTableTexts,
      sourceBeforeChapters: sourceBeforeChapters,
      sourceAfterChapters: sourceAfterChapters,
      changedChapterIndices: changedChapterIndices,
      maxChapters: maxChapters,
    };

    // Send lightweight result (no XML) to main thread
    self.postMessage({
      type: 'result',
      // Metadata only — no cleanedXml, no beforeXml
      newSections: newSections,
      appliedModsCount: appliedMods.length,
      sourceBeforeChapters: sourceBeforeChapters,
      sourceAfterChapters: sourceAfterChapters,
      sourceBeforeTableTexts: sourceBeforeTableTexts,
      sourceAfterTableTexts: sourceAfterTableTexts,
      changedChapterIndices: changedChapterIndices,
      maxChapters: maxChapters,
      chapterLogs: chapterLogs,
      mismatchChapterCount: sourceBeforeChapters.length !== sourceAfterChapters.length,
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || 'Erreur inconnue dans le worker (prepare)' });
  }
}

/**
 * Format a target chapter for a language. Called by main thread before each API call.
 * msg: { type: 'format-target', lang, chIdx }
 * Returns: { type: 'target-formatted', lang, chIdx, targetText, targetFormatResult }
 */
function handleFormatTarget(data) {
  try {
    if (!_workerState) { self.postMessage({ type: 'error', message: 'Worker state not initialized' }); return; }
    var lang = data.lang;
    var chIdx = data.chIdx;
    var xml = _workerState.currentXml;

    // Re-detect sections + split target chapters
    var currentSections = detectSectionsInRawXml(xml);
    var currentTarget = null;
    for (var i = 0; i < currentSections.length; i++) {
      if (currentSections[i].lang === lang) { currentTarget = currentSections[i]; break; }
    }
    if (!currentTarget) {
      self.postMessage({ type: 'error', message: 'Section ' + lang + ' introuvable dans le XML' });
      return;
    }

    var targetChapters = splitSectionIntoChapters(xml, currentTarget.startPara, currentTarget.endPara);

    if (chIdx >= targetChapters.length) {
      self.postMessage({ type: 'target-formatted', lang: lang, chIdx: chIdx, skipped: true,
        targetChapterCount: targetChapters.length });
      return;
    }

    var targetResult = formatChapterTextWithTables(xml, targetChapters[chIdx]);

    self.postMessage({
      type: 'target-formatted',
      lang: lang,
      chIdx: chIdx,
      skipped: false,
      targetText: targetResult.text,
      targetFormatResult: targetResult,
      targetChapterStartPara: targetChapters[chIdx].startParaIdx,
      targetSectionStartPara: currentTarget.startPara,
      targetChapterCount: targetChapters.length,
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || 'Erreur format-target' });
  }
}

/**
 * Apply a single chapter's API response. Called after each API response.
 * msg: { type: 'apply-chapter', lang, chIdx, modifiedChapter, targetFormatResult, chapterRelStart }
 * Returns: { type: 'chapter-applied', lang, chIdx, replaceCount, deleteCount, insertCount }
 */
function handleApplyChapter(data) {
  try {
    if (!_workerState) { self.postMessage({ type: 'error', message: 'Worker state not initialized' }); return; }

    var parsed = parseChapterResponse(data.modifiedChapter || '');
    var chapterRelStart = data.targetChapterStartPara - data.targetSectionStartPara;
    var chapterMods = buildChapterModificationsWithTables(parsed, chapterRelStart, data.targetFormatResult);

    // Accumulate mods for this language
    if (!_workerState.pendingMods) _workerState.pendingMods = [];
    for (var i = 0; i < chapterMods.length; i++) {
      _workerState.pendingMods.push(chapterMods[i]);
    }

    var replaceCount = chapterMods.filter(function(m) { return m.action === 'replace_text'; }).length;
    var deleteCount = chapterMods.filter(function(m) { return m.action === 'delete_paragraph' || m.action === 'delete_table_row'; }).length;
    var insertCount = chapterMods.filter(function(m) { return m.action === 'insert_after' || m.action === 'insert_table_row'; }).length;

    self.postMessage({
      type: 'chapter-applied',
      lang: data.lang,
      chIdx: data.chIdx,
      replaceCount: replaceCount,
      deleteCount: deleteCount,
      insertCount: insertCount,
      totalPendingMods: _workerState.pendingMods.length,
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || 'Erreur apply-chapter' });
  }
}

/**
 * Apply all accumulated mods for a language and compute stats.
 * msg: { type: 'apply-lang-done', lang }
 * Returns: { type: 'lang-applied', lang, modCount, totalParagraphs }
 */
function handleApplyLangDone(data) {
  try {
    if (!_workerState) { self.postMessage({ type: 'error', message: 'Worker state not initialized' }); return; }
    var lang = data.lang;
    var mods = _workerState.pendingMods || [];

    // Find current target section
    var currentSections = detectSectionsInRawXml(_workerState.currentXml);
    var currentTarget = null;
    for (var i = 0; i < currentSections.length; i++) {
      if (currentSections[i].lang === lang) { currentTarget = currentSections[i]; break; }
    }

    if (mods.length > 0 && currentTarget) {
      _workerState.currentXml = applyModificationsToSection(_workerState.currentXml, currentTarget.startPara, mods);
    }

    // Compute stats
    var updatedSections = detectSectionsInRawXml(_workerState.currentXml);
    var updatedTarget = null;
    for (var j = 0; j < updatedSections.length; j++) {
      if (updatedSections[j].lang === lang) { updatedTarget = updatedSections[j]; break; }
    }

    _workerState.pendingMods = [];

    self.postMessage({
      type: 'lang-applied',
      lang: lang,
      modCount: mods.length,
      totalParagraphs: updatedTarget ? updatedTarget.endPara - updatedTarget.startPara + 1 : 0,
      replaceCount: mods.filter(function(m) { return m.action === 'replace_text'; }).length,
      deleteCount: mods.filter(function(m) { return m.action === 'delete_paragraph'; }).length,
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || 'Erreur apply-lang-done' });
  }
}

/**
 * Return the final modified XML. Single large transfer at the end.
 * Returns: { type: 'final-xml', xml }
 */
function handleGetFinalXml() {
  try {
    if (!_workerState) { self.postMessage({ type: 'error', message: 'Worker state not initialized' }); return; }
    self.postMessage({ type: 'final-xml', xml: _workerState.currentXml });
    // Free memory
    _workerState = null;
    _paraCache = {};
    _trCache = {};
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || 'Erreur get-final-xml' });
  }
}
