'use client';

import { useState, useCallback, useRef } from 'react';
import { Loader as Loader2, CircleCheck as CheckCircle2, BookOpen, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Modification } from '@/lib/types/docx';
import type { LanguageSection } from '@/lib/docx-section-detector';
import type { RawSection } from '@/lib/docx-rebuilder';

/** Yield to the main thread so the browser stays responsive during heavy processing. */
function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** Worker prepare result (lightweight — no XML) */
interface WorkerPrepareResult {
  newSections: RawSection[];
  appliedModsCount: number;
  sourceBeforeChapters: Array<{ title: string; startParaIdx: number; endParaIdx: number; paragraphCount: number }>;
  sourceAfterChapters: Array<{ title: string; startParaIdx: number; endParaIdx: number; paragraphCount: number }>;
  sourceBeforeTableTexts: string[];
  sourceAfterTableTexts: string[];
  changedChapterIndices: number[];
  maxChapters: number;
  chapterLogs: Array<{ index: number; title: string; beforeLines: number; afterLines: number; isChanged: boolean; snippet: string }>;
  mismatchChapterCount: boolean;
}

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
    addLog('Préparation du document (Web Worker — pas de freeze navigateur)...');

    // === STEP 1-3: Heavy XML processing in Web Worker ===
    // Worker keeps XML in memory — main thread only gets lightweight metadata
    const worker = new Worker('/propagation-worker.js');

    /** Send a message to the worker and wait for a specific response type */
    function workerRpc<T>(msg: Record<string, unknown>, responseType: string): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        function handler(e: MessageEvent) {
          if (e.data.type === 'progress') {
            addLog(`${e.data.step}: ${e.data.detail}`);
          } else if (e.data.type === responseType) {
            worker.removeEventListener('message', handler);
            resolve(e.data as T);
          } else if (e.data.type === 'error') {
            worker.removeEventListener('message', handler);
            reject(new Error(e.data.message));
          }
        }
        worker.addEventListener('message', handler);
        worker.postMessage(msg);
      });
    }

    let prepareResult: WorkerPrepareResult;
    try {
      prepareResult = await workerRpc<WorkerPrepareResult>(
        { type: 'prepare', xml: documentXml, sourceLang },
        'result',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      addLog(`ERREUR Worker : ${message}`);
      worker.terminate();
      return;
    }

    // Unpack lightweight results (no XML strings)
    const {
      newSections,
      appliedModsCount,
      sourceBeforeChapters,
      sourceAfterChapters,
      sourceBeforeTableTexts,
      sourceAfterTableTexts,
      changedChapterIndices,
      maxChapters,
      chapterLogs,
      mismatchChapterCount,
    } = prepareResult;

    addLog(`${appliedModsCount} modifications détectées dans la section source`);

    addLog(`Source AVANT : ${sourceBeforeChapters.length} chapitres`);
    for (const ch of sourceBeforeChapters) {
      addLog(`  [avant] ch "${ch.title}" paras ${ch.startParaIdx}-${ch.endParaIdx} (${ch.paragraphCount}p)`);
    }
    addLog(`Source APRÈS : ${sourceAfterChapters.length} chapitres`);
    for (const ch of sourceAfterChapters) {
      addLog(`  [après] ch "${ch.title}" paras ${ch.startParaIdx}-${ch.endParaIdx} (${ch.paragraphCount}p)`);
    }
    addLog(`Sections : ${newSections.map((s) => `${s.lang}(${s.startPara}-${s.endPara})`).join(', ')}`);

    if (mismatchChapterCount) {
      addLog(`⚠ ATTENTION : nombre de chapitres différent avant/après (${sourceBeforeChapters.length} vs ${sourceAfterChapters.length})`);
    }

    for (const cl of chapterLogs) {
      addLog(`  ch.${cl.index + 1} "${cl.title}" : before=${cl.beforeLines}p after=${cl.afterLines}p modifié=${cl.isChanged}`);
      if (!cl.isChanged && cl.snippet) {
        addLog(`    aperçu: "${cl.snippet}..."`);
      }
    }

    addLog(`Chapitres modifiés : ${changedChapterIndices.length}/${maxChapters} — ${changedChapterIndices.map((idx) => `"${sourceAfterChapters[idx].title.substring(0, 30)}"`).join(', ') || '(aucun)'}`);

    if (changedChapterIndices.length === 0) {
      addLog('Aucune modification de contenu détectée — récupération du XML final...');
      const finalResult = await workerRpc<{ xml: string }>({ type: 'get-final-xml' }, 'final-xml');
      worker.terminate();
      setProgress(100);
      if (!completeCalled.current) {
        completeCalled.current = true;
        onComplete({ modifiedDocumentXml: finalResult.xml, languageStats: [], legacyResults: [] });
      }
      return;
    }

    // === STEP 4: API calls on main thread, XML ops in Worker ===
    const languageStats: PropagationResult['languageStats'] = [];
    const legacyResults: LanguageResult[] = [];
    const failedLangs: string[] = [];

    const orderedTargets = selectedLangs
      .map((l) => ({ lang: l, section: newSections.find((s) => s.lang === l) }))
      .filter((x): x is { lang: string; section: RawSection } => x.section != null)
      .sort((a, b) => b.section.startPara - a.section.startPara);

    const totalWork = changedChapterIndices.length * orderedTargets.length;
    let workDone = 0;

    for (let i = 0; i < orderedTargets.length; i++) {
      const { lang } = orderedTargets[i];
      setLangStatus((prev) => ({ ...prev, [lang]: 'active' }));
      addLog(`Propagation ${lang} en cours...`);
      await yieldToMain();

      try {
        let targetChapterCount = 0;

        for (const chIdx of changedChapterIndices) {
          // Ask worker to format the target chapter (worker does the heavy XML scan)
          const targetInfo = await workerRpc<{
            lang: string; chIdx: number; skipped: boolean;
            targetText?: string; targetFormatResult?: Record<string, unknown>;
            targetChapterStartPara?: number; targetSectionStartPara?: number;
            targetChapterCount: number;
          }>({ type: 'format-target', lang, chIdx }, 'target-formatted');

          targetChapterCount = targetInfo.targetChapterCount;

          if (targetInfo.skipped) {
            addLog(`${lang} : chapitre ${chIdx + 1} absent — ignoré`);
            workDone++;
            setProgress(Math.round((workDone / totalWork) * 95));
            continue;
          }

          addLog(`${lang} : chapitre ${chIdx + 1}/${maxChapters} "${sourceAfterChapters[chIdx].title.substring(0, 40)}"...`);

          // API call on main thread (non-blocking network)
          const res = await fetch('/api/propagate/chapter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceChapterBefore: sourceBeforeTableTexts[chIdx],
              sourceChapterAfter: sourceAfterTableTexts[chIdx],
              targetChapter: targetInfo.targetText,
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

          // Send API response to worker for parsing + mod building
          const applied = await workerRpc<{
            lang: string; chIdx: number;
            replaceCount: number; deleteCount: number; insertCount: number;
            totalPendingMods: number;
          }>({
            type: 'apply-chapter',
            lang,
            chIdx,
            modifiedChapter: data.modifiedChapter,
            targetFormatResult: targetInfo.targetFormatResult,
            targetChapterStartPara: targetInfo.targetChapterStartPara,
            targetSectionStartPara: targetInfo.targetSectionStartPara,
          }, 'chapter-applied');

          addLog(`${lang} : ch.${chIdx + 1} → ${applied.replaceCount} rempl, ${applied.deleteCount} suppr, ${applied.insertCount} insert`);

          workDone++;
          setProgress(Math.round((workDone / totalWork) * 95));
        }

        // Tell worker to apply all accumulated mods for this language
        const langResult = await workerRpc<{
          lang: string; modCount: number; totalParagraphs: number;
          replaceCount: number; deleteCount: number;
        }>({ type: 'apply-lang-done', lang }, 'lang-applied');

        if (langResult.modCount > 0) {
          addLog(`${lang} : ${langResult.modCount} modification(s) appliquée(s) au total`);
        } else {
          addLog(`${lang} : aucune modification à appliquer`);
        }

        addLog(`${lang} : ${targetChapterCount} chapitres détectés`);

        languageStats.push({
          language: lang,
          modifiedParagraphs: langResult.modCount,
          totalParagraphs: langResult.totalParagraphs,
        });

        legacyResults.push({
          language: lang,
          modifications: (modifications || []).map((mod) => ({
            ...mod,
            status: 'translated' as const,
          })),
          stats: {
            translated: langResult.replaceCount,
            deleted: langResult.deleteCount,
            total: langResult.modCount,
          },
        });

        setLangStatus((prev) => ({ ...prev, [lang]: 'done' }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur inconnue';
        setLangStatus((prev) => ({ ...prev, [lang]: 'error' }));
        addLog(`ERREUR ${lang} : ${message}`);
        failedLangs.push(lang);
        setWarnings((prev) => [...prev, `${lang} : ${message}`]);
        workDone += changedChapterIndices.length;
        setProgress(Math.round((workDone / totalWork) * 95));
      }
    }

    for (const lang of selectedLangs) {
      if (!orderedTargets.find((t) => t.lang === lang)) {
        setLangStatus((prev) => ({ ...prev, [lang]: 'error' }));
        setWarnings((prev) => [...prev, `${lang} : section introuvable`]);
        failedLangs.push(lang);
      }
    }

    if (failedLangs.length > 0 && failedLangs.length < selectedLangs.length) {
      addLog(`Propagation terminée avec ${failedLangs.length} erreur(s)`);
    } else if (failedLangs.length === 0) {
      addLog('Propagation terminée avec succès');
    } else {
      addLog('Propagation échouée pour toutes les langues');
    }

    // Get final XML from worker (single large transfer at the end)
    addLog('Récupération du XML final...');
    let finalXml: string;
    try {
      const finalResult = await workerRpc<{ xml: string }>({ type: 'get-final-xml' }, 'final-xml');
      finalXml = finalResult.xml;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      addLog(`ERREUR récupération XML : ${message}`);
      worker.terminate();
      return;
    }
    worker.terminate();

    setProgress(100);

    if (
      !completeCalled.current &&
      (languageStats.length > 0 || failedLangs.length < selectedLangs.length)
    ) {
      completeCalled.current = true;
      const result: PropagationResult = {
        modifiedDocumentXml: finalXml,
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
