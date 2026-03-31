'use client';

import { useState, useCallback, useRef } from 'react';
import { Loader as Loader2, CircleCheck as CheckCircle2, BookOpen, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Modification } from '@/lib/types/docx';
import type { LanguageSection } from '@/lib/docx-section-detector';
import type { RawSection } from '@/lib/docx-rebuilder';

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

    addLog('Initialisation du traitement (approche par chapitres)...');

    // === STEP 1: Clean source section ===
    addLog('Nettoyage de la section source...');
    const { cleanSourceSection } = await import('@/lib/docx-source-cleaner');
    const { detectSectionsInRawXml, applyModificationsToSection } = await import('@/lib/docx-rebuilder');
    const {
      splitSectionIntoChapters,
      formatChapterText,
      extractTextsFromFormat,
      parseChapterResponse,
      buildChapterModifications,
    } = await import('@/lib/docx-chapter-splitter');

    const rawSections = detectSectionsInRawXml(documentXml);
    const rawSourceSection = rawSections.find((s) => s.lang === sourceLang);
    if (!rawSourceSection) {
      addLog('ERREUR : Section source introuvable');
      return;
    }
    addLog(`Section source ${sourceLang} : paras ${rawSourceSection.startPara}-${rawSourceSection.endPara}`);

    const { cleanedXml, modifications: appliedMods } = cleanSourceSection(
      documentXml,
      rawSourceSection.startPara,
      rawSourceSection.endPara,
    );

    addLog(`${appliedMods.length} modifications détectées dans la section source`);

    // === STEP 2: Split source into chapters (before and after cleaning) ===
    const sourceBeforeChapters = splitSectionIntoChapters(
      documentXml,
      rawSourceSection.startPara,
      rawSourceSection.endPara,
    );

    const newSections = detectSectionsInRawXml(cleanedXml);
    const cleanedSource = newSections.find((s) => s.lang === sourceLang);
    if (!cleanedSource) {
      addLog('ERREUR : Section source nettoyée introuvable');
      return;
    }

    const sourceAfterChapters = splitSectionIntoChapters(
      cleanedXml,
      cleanedSource.startPara,
      cleanedSource.endPara,
    );

    addLog(`Source : ${sourceBeforeChapters.length} chapitres (avant), ${sourceAfterChapters.length} chapitres (après nettoyage)`);
    addLog(`Sections : ${newSections.map((s) => `${s.lang}(${s.startPara}-${s.endPara})`).join(', ')}`);

    // === STEP 3: Find which chapters changed ===
    const maxChapters = Math.min(sourceBeforeChapters.length, sourceAfterChapters.length);
    const sourceBeforeTexts: string[] = [];
    const sourceAfterTexts: string[] = [];
    const changedChapterIndices: number[] = [];

    for (let i = 0; i < maxChapters; i++) {
      const beforeText = formatChapterText(documentXml, sourceBeforeChapters[i]);
      const afterText = formatChapterText(cleanedXml, sourceAfterChapters[i]);
      sourceBeforeTexts.push(beforeText);
      sourceAfterTexts.push(afterText);
      if (beforeText.replace(/\s+/g, ' ').trim() !== afterText.replace(/\s+/g, ' ').trim()) {
        changedChapterIndices.push(i);
      }
    }

    addLog(`${changedChapterIndices.length}/${maxChapters} chapitre(s) modifié(s)`);
    if (changedChapterIndices.length > 0) {
      for (const idx of changedChapterIndices) {
        addLog(`  → Chapitre ${idx + 1}: "${sourceAfterChapters[idx].title.substring(0, 50)}"`);
      }
    }

    if (changedChapterIndices.length === 0) {
      addLog('Aucune modification de contenu détectée — propagation terminée');
      setProgress(100);
      if (!completeCalled.current) {
        completeCalled.current = true;
        onComplete({ modifiedDocumentXml: cleanedXml, languageStats: [], legacyResults: [] });
      }
      return;
    }

    // === STEP 4: Process target sections in REVERSE document order ===
    let currentXml = cleanedXml;
    const languageStats: PropagationResult['languageStats'] = [];
    const legacyResults: LanguageResult[] = [];
    const failedLangs: string[] = [];

    const orderedTargets = selectedLangs
      .map((l) => ({ lang: l, section: newSections.find((s) => s.lang === l) }))
      .filter((x): x is { lang: string; section: RawSection } => x.section != null)
      .sort((a, b) => b.section.startPara - a.section.startPara);

    // Total work units for progress: changedChapters × languages
    const totalWork = changedChapterIndices.length * orderedTargets.length;
    let workDone = 0;

    for (let i = 0; i < orderedTargets.length; i++) {
      const { lang } = orderedTargets[i];
      setLangStatus((prev) => ({ ...prev, [lang]: 'active' }));
      addLog(`Propagation ${lang} en cours...`);

      try {
        // Re-detect sections in current XML for accurate boundaries
        const currentSections = detectSectionsInRawXml(currentXml);
        const currentTarget = currentSections.find((s) => s.lang === lang);
        if (!currentTarget) {
          throw new Error(`Section ${lang} introuvable dans le XML`);
        }

        // Split target section into chapters
        const targetChapters = splitSectionIntoChapters(
          currentXml,
          currentTarget.startPara,
          currentTarget.endPara,
        );
        addLog(`${lang} : ${targetChapters.length} chapitres détectés`);

        // Collect all modifications from all chapters for this language
        const allMods: Array<{ relativeParagraphIndex: number; action: 'delete_paragraph' | 'replace_text' | 'insert_after'; newText?: string }> = [];

        for (const chIdx of changedChapterIndices) {
          if (chIdx >= targetChapters.length) {
            addLog(`${lang} : chapitre ${chIdx + 1} absent — ignoré`);
            workDone++;
            setProgress(Math.round((workDone / totalWork) * 95));
            continue;
          }

          const targetText = formatChapterText(currentXml, targetChapters[chIdx]);

          addLog(`${lang} : chapitre ${chIdx + 1}/${maxChapters} "${sourceAfterChapters[chIdx].title.substring(0, 40)}"...`);

          // Call chapter-based propagation API
          const res = await fetch('/api/propagate/chapter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceChapterBefore: sourceBeforeTexts[chIdx],
              sourceChapterAfter: sourceAfterTexts[chIdx],
              targetChapter: targetText,
              targetLang: lang,
              useGlossary,
            }),
          });

          const responseText = await res.text();
          let data: { modifiedChapter?: string; error?: string };
          try {
            data = JSON.parse(responseText);
          } catch {
            throw new Error(`Réponse invalide du serveur (${res.status})`);
          }
          if (!res.ok) {
            throw new Error(data.error || `Erreur ${res.status}`);
          }

          // Parse Claude's response and build modifications
          const parsed = parseChapterResponse(data.modifiedChapter || '');
          const originalParaTexts = extractTextsFromFormat(targetText);
          const chapterRelStart = targetChapters[chIdx].startParaIdx - currentTarget.startPara;

          const chapterMods = buildChapterModifications(originalParaTexts, parsed, chapterRelStart);
          allMods.push(...chapterMods);

          const replaceCount = chapterMods.filter((m) => m.action === 'replace_text').length;
          const deleteCount = chapterMods.filter((m) => m.action === 'delete_paragraph').length;
          const insertCount = chapterMods.filter((m) => m.action === 'insert_after').length;
          addLog(`${lang} : ch.${chIdx + 1} → ${replaceCount} rempl, ${deleteCount} suppr, ${insertCount} insert`);

          workDone++;
          setProgress(Math.round((workDone / totalWork) * 95));
        }

        // Apply all modifications for this language in one batch
        if (allMods.length > 0) {
          currentXml = applyModificationsToSection(currentXml, currentTarget.startPara, allMods);
          addLog(`${lang} : ${allMods.length} modification(s) appliquée(s) au total`);
        } else {
          addLog(`${lang} : aucune modification à appliquer`);
        }

        // Compute stats
        const updatedSections = detectSectionsInRawXml(currentXml);
        const updatedTarget = updatedSections.find((s) => s.lang === lang);
        languageStats.push({
          language: lang,
          modifiedParagraphs: allMods.length,
          totalParagraphs: updatedTarget ? updatedTarget.endPara - updatedTarget.startPara + 1 : 0,
        });

        // Legacy results for export
        legacyResults.push({
          language: lang,
          modifications: (modifications || []).map((mod) => ({
            ...mod,
            status: 'translated' as const,
          })),
          stats: {
            translated: allMods.filter((m) => m.action === 'replace_text').length,
            deleted: allMods.filter((m) => m.action === 'delete_paragraph').length,
            total: allMods.length,
          },
        });

        setLangStatus((prev) => ({ ...prev, [lang]: 'done' }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur inconnue';
        setLangStatus((prev) => ({ ...prev, [lang]: 'error' }));
        addLog(`ERREUR ${lang} : ${message}`);
        failedLangs.push(lang);
        setWarnings((prev) => [...prev, `${lang} : ${message}`]);
        // Skip remaining work units for this language
        workDone += changedChapterIndices.length;
        setProgress(Math.round((workDone / totalWork) * 95));
      }
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
