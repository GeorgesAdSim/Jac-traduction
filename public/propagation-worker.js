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

// ── Paragraph positions ──────────────────────────────────────────

function findParagraphPositions(xml) {
  var positions = [];
  var openTag = '<w:p';
  var closeTag = '</w:p>';
  var searchFrom = 0;

  while (searchFrom < xml.length) {
    var openIdx = xml.indexOf(openTag, searchFrom);
    if (openIdx === -1) break;

    var charAfterTag = xml[openIdx + openTag.length];
    if (charAfterTag !== '>' && charAfterTag !== ' ') {
      searchFrom = openIdx + openTag.length;
      continue;
    }

    var depth = 1;
    var pos = openIdx + openTag.length;
    while (depth > 0 && pos < xml.length) {
      var nextOpen = xml.indexOf(openTag, pos);
      var nextClose = xml.indexOf(closeTag, pos);

      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        var charAfter = xml[nextOpen + openTag.length];
        if (charAfter === '>' || charAfter === ' ') {
          depth++;
        }
        pos = nextOpen + openTag.length;
      } else {
        depth--;
        if (depth === 0) {
          var endPos = nextClose + closeTag.length;
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
  var positions = findParagraphPositions(xml);
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
  var paraPositions = findParagraphPositions(fullXml);
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
      if (/w:val="[Hh]eading\d*"/.test(pPr)) return true;
      if (pPr.indexOf('w:val="TOC') !== -1) return true;
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
  var positions = findParagraphPositions(xml);
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
  var positions = findParagraphPositions(xml);
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
  var positions = findParagraphPositions(xml);
  var trBoundaries = findTableRowBoundaries(xml);

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

// ── Worker message handler ──────────────────────────────────────

self.onmessage = function(e) {
  var data = e.data;

  if (data.type !== 'prepare') {
    self.postMessage({ type: 'error', message: 'Unknown message type: ' + data.type });
    return;
  }

  try {
    var xml = data.xml;
    var sourceLang = data.sourceLang;

    self.postMessage({ type: 'progress', step: 'Détection', detail: 'Détection des sections...' });

    var rawSections = detectSectionsInRawXml(xml);
    var rawSourceSection = null;
    for (var s = 0; s < rawSections.length; s++) {
      if (rawSections[s].lang === sourceLang) {
        rawSourceSection = rawSections[s];
        break;
      }
    }

    if (!rawSourceSection) {
      self.postMessage({ type: 'error', message: 'Section source ' + sourceLang + ' introuvable' });
      return;
    }

    self.postMessage({ type: 'progress', step: 'Source', detail: 'Section ' + sourceLang + ' : paras ' + rawSourceSection.startPara + '-' + rawSourceSection.endPara });

    // Clean "after" state
    self.postMessage({ type: 'progress', step: 'Nettoyage', detail: 'Nettoyage after (suppression rouge, garder vert)...' });
    var afterResult = cleanSourceSection(xml, rawSourceSection.startPara, rawSourceSection.endPara, 'after');
    var cleanedXml = afterResult.cleanedXml;
    var appliedMods = afterResult.modifications;

    // Clean "before" state
    self.postMessage({ type: 'progress', step: 'Nettoyage', detail: 'Nettoyage before (suppression vert, garder rouge)...' });
    var beforeResult = cleanSourceSection(xml, rawSourceSection.startPara, rawSourceSection.endPara, 'before');
    var beforeXml = beforeResult.cleanedXml;

    self.postMessage({ type: 'progress', step: 'Modifications', detail: appliedMods.length + ' modifications détectées' });

    // Split source into chapters (before)
    self.postMessage({ type: 'progress', step: 'Chapitres', detail: 'Découpage en chapitres...' });
    var beforeSections = detectSectionsInRawXml(beforeXml);
    var beforeSourceSection = null;
    for (var bs = 0; bs < beforeSections.length; bs++) {
      if (beforeSections[bs].lang === sourceLang) {
        beforeSourceSection = beforeSections[bs];
        break;
      }
    }
    if (!beforeSourceSection) {
      self.postMessage({ type: 'error', message: 'Section source "avant" introuvable' });
      return;
    }
    var sourceBeforeChapters = splitSectionIntoChapters(beforeXml, beforeSourceSection.startPara, beforeSourceSection.endPara);

    // Split source into chapters (after)
    var newSections = detectSectionsInRawXml(cleanedXml);
    var cleanedSource = null;
    for (var ns = 0; ns < newSections.length; ns++) {
      if (newSections[ns].lang === sourceLang) {
        cleanedSource = newSections[ns];
        break;
      }
    }
    if (!cleanedSource) {
      self.postMessage({ type: 'error', message: 'Section source nettoyée introuvable' });
      return;
    }
    var sourceAfterChapters = splitSectionIntoChapters(cleanedXml, cleanedSource.startPara, cleanedSource.endPara);

    self.postMessage({ type: 'progress', step: 'Chapitres', detail: 'Source AVANT : ' + sourceBeforeChapters.length + ' chapitres, APRÈS : ' + sourceAfterChapters.length + ' chapitres' });

    // Compare chapters
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

      if (isChanged) {
        changedChapterIndices.push(ci);
      }

      chapterLogs.push({
        index: ci,
        title: sourceAfterChapters[ci].title.substring(0, 40),
        beforeLines: beforeLineCount,
        afterLines: afterLineCount,
        isChanged: isChanged,
        snippet: !isChanged ? aText.substring(0, 80).replace(/\n/g, ' | ') : '',
      });
    }

    self.postMessage({ type: 'progress', step: 'Comparaison', detail: 'Chapitres modifiés : ' + changedChapterIndices.length + '/' + maxChapters });

    // Return all results
    self.postMessage({
      type: 'result',
      cleanedXml: cleanedXml,
      beforeXml: beforeXml,
      rawSections: rawSections,
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
    self.postMessage({ type: 'error', message: err.message || 'Erreur inconnue dans le worker' });
  }
};
