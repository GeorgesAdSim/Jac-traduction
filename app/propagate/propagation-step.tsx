'use client';

import { useState, useCallback, useRef } from 'react';
import { Loader as Loader2, CircleCheck as CheckCircle2, BookOpen, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Modification } from '@/lib/types/docx';
import type { LanguageSection } from '@/lib/docx-section-detector';
import type { AppliedModification } from '@/lib/docx-source-cleaner';

const AVAILABLE_LANGUAGES = [
  { code: 'FR', name: 'Français' },
  { code: 'EN', name: 'Anglais' },
  { code: 'DE', name: 'Allemand' },
  { code: 'NL', name: 'Néerlandais' },
  { code: 'RU', name: 'Russe' },
  { code: 'ES', name: 'Espagnol' },
  { code: 'IT', name: 'Italien' },
  { code: 'PL', name: 'Polonais' },
  { code: 'AR', name: 'Arabe' },
  { code: 'PT', name: 'Portugais' },
];

export interface LanguageResult {
  language: string;
  modifications: Array<Modification & { translatedText?: string; status: string }>;
  stats: { translated: number; deleted: number; total: number };
}

export interface PropagationResult {
  modifiedDocumentXml: string;
  languageStats: Array<{
    language: string;
    modifiedParagraphs: number;
    totalParagraphs: number;
  }>;
  legacyResults: LanguageResult[];
}

interface PropagationStepProps {
  modifications?: Modification[];
  sourceLang?: string;
  sections?: LanguageSection[];
  documentXml?: string;
  onComplete: (result: PropagationResult) => void;
}

/**
 * Check if two paragraphs from different languages are structurally similar
 * by comparing shared numeric markers (section numbers, error codes, etc.).
 */
function paragraphsAreSimilar(text1: string, text2: string): boolean {
  const t1 = (text1 || '').trim();
  const t2 = (text2 || '').trim();
  if (!t1 && !t2) return true;
  if (!t1 || !t2) return false;

  const markerRegex = /\b\d+(?:\.\d+)*\b|E\d+|fig\.\d+|n°\d+|§[\d.]+/gi;
  const markers1 = (t1.match(markerRegex) || []).map((m) => m.toLowerCase());
  const markers2 = (t2.match(markerRegex) || []).map((m) => m.toLowerCase());

  if (markers1.length === 0 && markers2.length === 0) return false;

  for (const m of markers1) {
    if (markers2.indexOf(m) >= 0) return true;
  }
  return false;
}

export function PropagationStep({
  modifications,
  sourceLang = 'EN',
  sections,
  documentXml,
  onComplete,
}: PropagationStepProps) {
  const documentLangs = sections?.map((s) => s.lang) ?? [];
  const availableForSelection = AVAILABLE_LANGUAGES.filter(
    (l) => l.code !== sourceLang && documentLangs.includes(l.code)
  );
  const targetLangs = availableForSelection.length > 0
    ? availableForSelection
    : AVAILABLE_LANGUAGES.filter((l) => l.code !== sourceLang);

  const defaultSelected = targetLangs.map((l) => l.code);

  const [selectedLangs, setSelectedLangs] = useState<string[]>(defaultSelected);
  const [useGlossary, setUseGlossary] = useState(true);
  const [started, setStarted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [langStatus, setLangStatus] = useState<Record<string, 'pending' | 'active' | 'done' | 'error'>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const completeCalled = useRef(false);

  const toggleLang = (code: string) => {
    setSelectedLangs((prev) =>
      prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code]
    );
  };

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg]);
  }, []);

  const startPropagation = useCallback(async () => {
    if (!modifications || selectedLangs.length === 0 || !documentXml || !sections) return;

    setStarted(true);
    setProgress(0);
    const initialStatus: Record<string, 'pending'> = {};
    for (const lang of selectedLangs) initialStatus[lang] = 'pending';
    setLangStatus(initialStatus);

    addLog('Initialisation du traitement...');

    // === STEP 1: Clean source section ===
    addLog('Nettoyage de la section source...');
    const { cleanSourceSection } = await import('@/lib/docx-source-cleaner');
    const { modifyParagraphAtIndex, getParagraphTexts } = await import('@/lib/docx-rebuilder');

    const sourceSection = sections.find((s) => s.isSource);
    if (!sourceSection) {
      addLog('ERREUR : Section source introuvable');
      return;
    }

    const { cleanedXml, modifications: appliedMods } = cleanSourceSection(
      documentXml,
      sourceSection.startPara,
      sourceSection.endPara
    );

    addLog(`${appliedMods.length} modifications détectées dans la section source`);

    // === STEP 2: Analyze modifications ===

    // 2a. Identify deleted paragraphs
    const deletedParas: Record<number, boolean> = {};
    for (const mod of appliedMods) {
      if (mod.paragraphDeleted) deletedParas[mod.paragraphIndex] = true;
    }
    const deletedCount = Object.keys(deletedParas).length;

    // 2b. Group mod types per paragraph
    const paraModTypes: Record<number, Record<string, boolean>> = {};
    for (const mod of appliedMods) {
      if (!paraModTypes[mod.paragraphIndex]) paraModTypes[mod.paragraphIndex] = {};
      paraModTypes[mod.paragraphIndex][mod.type] = true;
    }

    // 2c. Identify full-paragraph ADD indices (paragraphs where ONLY mod type is ADD)
    const fullParaAddIndices: number[] = [];
    for (const key of Object.keys(paraModTypes)) {
      const idx = Number(key);
      const types = Object.keys(paraModTypes[idx]);
      if (types.length === 1 && types[0] === 'ADD') {
        fullParaAddIndices.push(idx);
      }
    }
    fullParaAddIndices.sort((a, b) => a - b);

    // 2d. Get original source texts (before cleaning) for alignment computation
    const originalSourceTexts = getParagraphTexts(
      documentXml,
      sourceSection.startPara,
      sourceSection.endPara
    );

    // 2e. Get cleaned paragraph texts for each modified (non-deleted) paragraph
    const cleanedParaTexts: Record<number, string> = {};
    const modifiedIndices = Object.keys(paraModTypes).map(Number).filter((idx) => !deletedParas[idx]);

    for (const relIdx of modifiedIndices) {
      let offset = 0;
      for (const delKey of Object.keys(deletedParas)) {
        if (Number(delKey) < relIdx) offset++;
      }
      const cleanedAbsIdx = sourceSection.startPara + relIdx - offset;
      const texts = getParagraphTexts(cleanedXml, cleanedAbsIdx, cleanedAbsIdx);
      cleanedParaTexts[relIdx] = texts[0] || '';
    }

    // 2f. Collect all paragraph texts to translate (full cleaned paragraphs)
    const textsToTranslate: Array<{ relIdx: number; text: string }> = [];
    for (const relIdx of modifiedIndices) {
      const text = cleanedParaTexts[relIdx];
      if (text.trim()) {
        textsToTranslate.push({ relIdx, text });
      }
    }

    addLog(`${textsToTranslate.length} paragraphes à traduire, ${deletedCount} paragraphes à supprimer`);
    addLog(`${fullParaAddIndices.length} paragraphes ADD détectés (alignement requis)`);

    // === STEP 3: Process each target language ===
    let currentXml = cleanedXml;
    const languageStats: PropagationResult['languageStats'] = [];
    const legacyResults: LanguageResult[] = [];
    const failedLangs: string[] = [];

    // Process target sections in DOCUMENT ORDER so cumulative offset is correct
    const orderedTargets = selectedLangs
      .map((l) => ({ lang: l, section: sections.find((s) => s.lang === l) }))
      .filter((x): x is { lang: string; section: LanguageSection } => x.section != null)
      .sort((a, b) => a.section.startPara - b.section.startPara);

    // Track cumulative paragraph offset (source deletions shift all subsequent sections)
    let cumulativeParaOffset = -deletedCount;

    for (let i = 0; i < orderedTargets.length; i++) {
      const { lang, section: targetSection } = orderedTargets[i];
      setLangStatus((prev) => ({ ...prev, [lang]: 'active' }));
      addLog(`Propagation ${lang} en cours...`);

      try {
        // 3a. Translate all paragraph texts for this language
        let translations: string[] = [];
        if (textsToTranslate.length > 0) {
          addLog(`${lang} : traduction de ${textsToTranslate.length} paragraphes...`);

          const res = await fetch('/api/propagate/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              texts: textsToTranslate.map((t) => t.text),
              targetLang: lang,
              useGlossary,
            }),
          });

          const responseText = await res.text();
          let data: { translations?: string[]; error?: string };
          try {
            data = JSON.parse(responseText);
          } catch {
            throw new Error(`Réponse invalide du serveur (${res.status})`);
          }
          if (!res.ok) {
            throw new Error(data.error || `Erreur ${res.status}`);
          }
          translations = data.translations || [];
          addLog(`${lang} : ${translations.length} traductions reçues`);
        }

        // Build translation map: relIdx → translated text
        const translationMap: Record<number, string> = {};
        for (let t = 0; t < textsToTranslate.length; t++) {
          translationMap[textsToTranslate[t].relIdx] = translations[t] || '';
        }

        // 3b. Compute adjusted target section boundaries
        const adjustedStart = targetSection.startPara + cumulativeParaOffset;
        const adjustedEnd = targetSection.endPara + cumulativeParaOffset;

        // Get target section texts for alignment
        const targetTexts = getParagraphTexts(currentXml, adjustedStart, adjustedEnd);

        addLog(`${lang} : section paras ${adjustedStart}-${adjustedEnd} (${targetTexts.length} paras)`);

        // 3c. Compute alignment: which full-paragraph ADDs are true inserts vs replacements
        // Walk ADDs in order. For each: if removing it from the source aligns the NEXT source
        // paragraph with the current target position → true insert (offset++).
        // Otherwise → replacement (no offset change).
        let alignOffset = 0;
        const isInsert: Record<number, boolean> = {};

        for (const addIdx of fullParaAddIndices) {
          const adjIdx = addIdx - alignOffset;
          const nextSourceText =
            addIdx + 1 < originalSourceTexts.length ? originalSourceTexts[addIdx + 1] : '';
          const targetAtAdj = adjIdx < targetTexts.length ? targetTexts[adjIdx] : '';

          if (paragraphsAreSimilar(nextSourceText, targetAtAdj)) {
            isInsert[addIdx] = true;
            alignOffset++;
          } else {
            isInsert[addIdx] = false;
          }
        }

        const insertAddCount = Object.keys(isInsert).filter((k) => isInsert[Number(k)]).length;
        const replaceAddCount = fullParaAddIndices.length - insertAddCount;
        addLog(
          `${lang} : alignement — ${insertAddCount} insertion(s), ${replaceAddCount} remplacement(s)`
        );

        // Helper: count true-insert ADDs before a given relative index
        const insertsBefore = (relIdx: number): number => {
          let count = 0;
          for (const addIdx of fullParaAddIndices) {
            if (addIdx >= relIdx) break;
            if (isInsert[addIdx]) count++;
          }
          return count;
        };

        // 3d. Apply modifications in REVERSE order (preserves indices)
        const sortedModIndices = Object.keys(paraModTypes)
          .map(Number)
          .sort((a, b) => b - a);

        let appliedCount = 0;
        let insertsDone = 0;
        let deletesDone = 0;

        for (const relIdx of sortedModIndices) {
          const adjRelIdx = relIdx - insertsBefore(relIdx);
          const absIdx = adjustedStart + adjRelIdx;

          // Full paragraph DELETE
          if (deletedParas[relIdx]) {
            currentXml = modifyParagraphAtIndex(currentXml, absIdx, 'delete_paragraph');
            deletesDone++;
            appliedCount++;
            continue;
          }

          const types = Object.keys(paraModTypes[relIdx]);
          const translation = translationMap[relIdx];
          if (!translation) continue;

          // Full-paragraph ADD — true insert
          if (types.length === 1 && types[0] === 'ADD' && isInsert[relIdx]) {
            const insertAfterIdx = absIdx - 1;
            if (insertAfterIdx >= adjustedStart) {
              currentXml = modifyParagraphAtIndex(currentXml, insertAfterIdx, 'insert_after', {
                newText: translation,
              });
              insertsDone++;
              appliedCount++;
            }
            continue;
          }

          // All other cases: MODIFY, partial DELETE, replacement ADD, mixed
          // → replace the entire target paragraph content with the translated cleaned source paragraph
          const tgtTexts = getParagraphTexts(currentXml, absIdx, absIdx);
          const tgtText = tgtTexts[0] || '';
          if (tgtText.trim()) {
            currentXml = modifyParagraphAtIndex(currentXml, absIdx, 'replace_text', {
              oldText: tgtText,
              newText: translation,
            });
            appliedCount++;
          }
        }

        // Update cumulative offset for next section
        cumulativeParaOffset += insertsDone - deletesDone;

        // Compute new target paragraph count
        const newTargetTexts = getParagraphTexts(
          currentXml,
          adjustedStart,
          adjustedEnd + insertsDone - deletesDone
        );

        languageStats.push({
          language: lang,
          modifiedParagraphs: appliedCount,
          totalParagraphs: newTargetTexts.length,
        });

        // Build legacy result for CSV/JSON export
        const legacyMods = (modifications || []).map((mod) => {
          const applied = appliedMods.find(
            (a: AppliedModification) => a.text === mod.originalText
          );
          if (!applied) return { ...mod, status: 'skipped' as const };
          if (applied.type === 'DELETE')
            return { ...mod, status: 'deleted' as const };
          return {
            ...mod,
            translatedText: translationMap[applied.paragraphIndex] || mod.originalText,
            status: 'translated' as const,
          };
        });
        legacyResults.push({
          language: lang,
          modifications: legacyMods,
          stats: {
            translated: appliedMods.filter((m: AppliedModification) => m.type !== 'DELETE').length,
            deleted: appliedMods.filter((m: AppliedModification) => m.type === 'DELETE').length,
            total: appliedMods.length,
          },
        });

        setLangStatus((prev) => ({ ...prev, [lang]: 'done' }));
        addLog(
          `${lang} : ${appliedCount} modification(s) appliquée(s) (${insertsDone} insert, ${deletesDone} delete)`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur inconnue';
        setLangStatus((prev) => ({ ...prev, [lang]: 'error' }));
        addLog(`ERREUR ${lang} : ${message}`);
        failedLangs.push(lang);
        setWarnings((prev) => [...prev, `${lang} : ${message}`]);
      }

      setProgress(Math.round(((i + 1) / orderedTargets.length) * 100));
    }

    // Handle selected langs that have no section
    for (const lang of selectedLangs) {
      if (!orderedTargets.find((t) => t.lang === lang)) {
        setLangStatus((prev) => ({ ...prev, [lang]: 'error' }));
        setWarnings((prev) => [...prev, `${lang} : section introuvable`]);
        failedLangs.push(lang);
      }
    }

    // Final summary
    if (failedLangs.length > 0 && failedLangs.length < selectedLangs.length) {
      addLog(`Propagation terminée avec ${failedLangs.length} erreur(s)`);
    } else if (failedLangs.length === 0) {
      addLog('Propagation terminée avec succès');
    } else {
      addLog('Propagation échouée pour toutes les langues');
    }

    setProgress(100);

    if (
      !completeCalled.current &&
      (languageStats.length > 0 || failedLangs.length < selectedLangs.length)
    ) {
      completeCalled.current = true;
      const result: PropagationResult = {
        modifiedDocumentXml: currentXml,
        languageStats,
        legacyResults,
      };
      setTimeout(() => onComplete(result), 800);
    }
  }, [modifications, selectedLangs, useGlossary, sourceLang, sections, documentXml, addLog, onComplete]);

  if (!started) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {sections && sections.length > 0 && (
          <div className="rounded border border-border bg-jac-bg-alt p-4">
            <p className="text-xs font-medium text-jac-text-secondary mb-2">
              Sections détectées dans le document :
            </p>
            <div className="flex flex-wrap gap-2">
              {sections.map((s) => (
                <span
                  key={s.lang}
                  className={cn(
                    'rounded px-2 py-1 text-xs font-medium',
                    s.isSource
                      ? 'bg-jac-red/10 text-jac-red border border-jac-red/30'
                      : 'bg-white border border-border text-jac-dark'
                  )}
                >
                  {s.lang} ({s.paragraphCount} §)
                  {s.isSource && ' — source'}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="rounded border border-border bg-white p-6">
          <h3 className="mb-4 text-sm font-semibold text-jac-dark">
            Sélectionnez les langues cibles
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {targetLangs.map((lang) => (
              <label
                key={lang.code}
                className="flex cursor-pointer items-center gap-3 rounded border border-border px-3 py-2.5 transition-colors hover:bg-jac-bg-alt/50"
              >
                <input
                  type="checkbox"
                  checked={selectedLangs.includes(lang.code)}
                  onChange={() => toggleLang(lang.code)}
                  className="h-4 w-4 rounded border-border accent-jac-red"
                />
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-jac-bg-alt text-xs font-bold text-jac-dark">
                    {lang.code}
                  </span>
                  <span className="text-sm text-jac-dark">{lang.name}</span>
                </div>
              </label>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between rounded bg-jac-bg-alt px-4 py-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-jac-text-secondary" />
              <span className="text-sm text-jac-dark">Utiliser le glossaire technique</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={useGlossary}
              onClick={() => setUseGlossary(!useGlossary)}
              className={cn(
                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors',
                useGlossary ? 'bg-jac-red' : 'bg-gray-300'
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform',
                  useGlossary ? 'translate-x-5' : 'translate-x-0.5'
                )}
              />
            </button>
          </div>
        </div>

        <Button
          onClick={startPropagation}
          disabled={selectedLangs.length === 0 || !documentXml || !sections}
          className="w-full"
        >
          Lancer la propagation ({selectedLangs.length} langue{selectedLangs.length > 1 ? 's' : ''})
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-jac-dark">
            {progress >= 100 ? 'Propagation terminée' : 'Propagation en cours...'}
          </span>
          <span className="font-mono text-jac-text-secondary">{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-jac-bg-alt">
          <div
            className="h-full rounded-full bg-jac-red transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="flex gap-2 sm:gap-3">
        {selectedLangs.map((code) => {
          const status = langStatus[code] || 'pending';
          return (
            <div
              key={code}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded border px-2 py-2.5 text-sm font-medium transition-colors sm:px-3',
                status === 'done' && 'border-green-200 bg-green-50 text-green-700',
                status === 'active' && 'border-jac-red/30 bg-red-50 text-jac-red',
                status === 'error' && 'border-orange-200 bg-orange-50 text-orange-700',
                status === 'pending' && 'border-border bg-white text-jac-text-secondary'
              )}
            >
              {status === 'done' && <CheckCircle2 className="h-4 w-4" />}
              {status === 'active' && <Loader2 className="h-4 w-4 animate-spin" />}
              {status === 'error' && <AlertTriangle className="h-4 w-4" />}
              {code}
            </div>
          );
        })}
      </div>

      <div className="rounded border border-border bg-jac-dark p-4">
        <div className="space-y-1 font-mono text-xs text-gray-400">
          {logs.map((log, i) => (
            <p key={i}>
              <span className="text-jac-text-secondary">[{String(i + 1).padStart(2, '0')}]</span>{' '}
              {log}
            </p>
          ))}
          {progress < 100 && <span className="inline-block animate-pulse">_</span>}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded border border-orange-200 bg-orange-50 p-4 text-sm text-orange-700">
          <p className="font-medium">Avertissements :</p>
          <ul className="mt-1 list-disc pl-4">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
