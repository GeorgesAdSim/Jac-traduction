'use client';

import { useState, useCallback, useRef } from 'react';
import { Loader as Loader2, CircleCheck as CheckCircle2, BookOpen, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Modification } from '@/lib/types/docx';
import type { LanguageSection } from '@/lib/docx-section-detector';

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
  /** The fully modified document XML (source cleaned + all targets propagated) */
  modifiedDocumentXml: string;
  /** Per-language statistics */
  languageStats: Array<{
    language: string;
    modifiedParagraphs: number;
    totalParagraphs: number;
  }>;
  /** Legacy LanguageResult[] for CSV/JSON download compatibility */
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
  // Only show languages that are present in the document (minus the source)
  const documentLangs = sections?.map((s) => s.lang) ?? [];
  const availableForSelection = AVAILABLE_LANGUAGES.filter(
    (l) => l.code !== sourceLang && documentLangs.includes(l.code)
  );
  // If no sections detected, fall back to full list minus source
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

    // Step 1: Clean source section
    addLog('Nettoyage de la section source...');
    const { cleanSourceSection } = await import('@/lib/docx-source-cleaner');
    const { getParagraphTexts } = await import('@/lib/docx-rebuilder');

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

    addLog(`${appliedMods.length} modifications appliquées à la section source`);

    // Get source section texts (after cleaning) for building context patches
    const sourceTexts = getParagraphTexts(
      cleanedXml,
      sourceSection.startPara,
      sourceSection.endPara
    );

    // Step 2: Propagate to each target language using lightweight patches
    // Patches are applied directly on the full XML with string.replace —
    // no paragraph splitting/reinsertion needed.
    let currentXml = cleanedXml;
    const languageStats: PropagationResult['languageStats'] = [];
    const legacyResults: LanguageResult[] = [];
    const failedLangs: string[] = [];
    const CONTEXT_RADIUS = 5;

    for (let i = 0; i < selectedLangs.length; i++) {
      const lang = selectedLangs[i];
      setLangStatus((prev) => ({ ...prev, [lang]: 'active' }));
      addLog(`Propagation ${lang} en cours...`);

      const targetSection = sections.find((s) => s.lang === lang);
      if (!targetSection) {
        addLog(`AVERTISSEMENT : Section ${lang} introuvable dans le document`);
        setLangStatus((prev) => ({ ...prev, [lang]: 'error' }));
        setWarnings((prev) => [...prev, `${lang} : section introuvable`]);
        failedLangs.push(lang);
        setProgress(Math.round(((i + 1) / selectedLangs.length) * 100));
        continue;
      }

      // Get target section texts for context extraction
      const targetTexts = getParagraphTexts(
        currentXml,
        targetSection.startPara,
        targetSection.endPara
      );

      // Build lightweight patches: only ~6 paragraphs of context per modification
      const patches = appliedMods.map((mod) => {
        const srcIdx = mod.paragraphIndex; // relative to source section
        const ratio = targetTexts.length / sourceTexts.length;
        const tgtIdx = Math.min(Math.round(srcIdx * ratio), targetTexts.length - 1);

        const srcStart = Math.max(0, srcIdx - CONTEXT_RADIUS);
        const srcEnd = Math.min(sourceTexts.length - 1, srcIdx + CONTEXT_RADIUS);
        const tgtStart = Math.max(0, tgtIdx - CONTEXT_RADIUS);
        const tgtEnd = Math.min(targetTexts.length - 1, tgtIdx + CONTEXT_RADIUS);

        return {
          type: mod.type as 'DELETE' | 'MODIFY' | 'ADD',
          text: mod.text,
          sourceContext: sourceTexts.slice(srcStart, srcEnd + 1).filter(Boolean),
          targetContext: targetTexts.slice(tgtStart, tgtEnd + 1).filter(Boolean),
          paragraphIndex: srcIdx,
        };
      });

      try {
        // Client-side batching: send max 8 patches per API call
        const BATCH_SIZE = 8;
        const totalBatches = Math.ceil(patches.length / BATCH_SIZE);
        const allPatchResults: Array<{ index: number; action: string; find: string; replace: string }> = [];
        let totalRequested = 0;

        addLog(`${lang} : ${patches.length} patches à envoyer en ${totalBatches} batch(es)`);

        for (let b = 0; b < totalBatches; b++) {
          const batch = patches.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
          addLog(`${lang} batch ${b + 1}/${totalBatches}...`);

          const res = await fetch('/api/propagate/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              patches: batch,
              sourceLang,
              targetLang: lang,
              useGlossary,
            }),
          });

          const text = await res.text();
          let data: { language: string; patches: Array<{ index: number; action: string; find: string; replace: string }>; stats: { patchesRequested: number; patchesApplied: number } };
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error(`Réponse invalide du serveur (${res.status})`);
          }

          if (!res.ok) {
            throw new Error((data as unknown as { error: string }).error || `Erreur ${res.status}`);
          }

          allPatchResults.push(...data.patches);
          totalRequested += data.stats.patchesRequested;

          // Granular progress: (completed langs + batch fraction of current lang) / total langs
          const batchFraction = (b + 1) / totalBatches;
          const langProgress = (i + batchFraction) / selectedLangs.length;
          setProgress(Math.round(langProgress * 100));
        }

        addLog(`${lang} : ${allPatchResults.length} patches reçus, application en cours...`);

        // Apply patches based on action type
        let appliedCount = 0;
        for (const patch of allPatchResults) {
          if (!patch.find || !currentXml.includes(patch.find)) continue;

          if (patch.action === 'delete') {
            // Remove the text from the XML
            currentXml = currentXml.replace(patch.find, '');
            appliedCount++;
          } else if (patch.action === 'insert_after') {
            // Find the <w:p> containing the anchor text and insert a new paragraph after it
            const anchorIdx = currentXml.indexOf(patch.find);
            if (anchorIdx !== -1) {
              // Find the end of the <w:p> that contains this anchor
              const closePIdx = currentXml.indexOf('</w:p>', anchorIdx);
              if (closePIdx !== -1) {
                const insertPos = closePIdx + '</w:p>'.length;
                const newPara = `<w:p><w:r><w:t>${patch.replace}</w:t></w:r></w:p>`;
                currentXml = currentXml.substring(0, insertPos) + newPara + currentXml.substring(insertPos);
                appliedCount++;
              }
            }
          } else {
            // modify: simple find/replace
            currentXml = currentXml.replace(patch.find, patch.replace);
            appliedCount++;
          }
        }

        languageStats.push({
          language: lang,
          modifiedParagraphs: appliedCount,
          totalParagraphs: targetTexts.length,
        });

        // Build legacy result for CSV/JSON export
        const legacyMods = (modifications || []).map((mod) => {
          const applied = appliedMods.find((a) => a.text === mod.originalText);
          if (!applied) return { ...mod, status: 'skipped' as const };
          if (applied.type === 'DELETE') return { ...mod, status: 'deleted' as const };
          return {
            ...mod,
            translatedText: `[${lang}] ${mod.originalText}`,
            status: 'translated' as const,
          };
        });
        legacyResults.push({
          language: lang,
          modifications: legacyMods,
          stats: {
            translated: appliedMods.filter((m) => m.type !== 'DELETE').length,
            deleted: appliedMods.filter((m) => m.type === 'DELETE').length,
            total: appliedMods.length,
          },
        });

        setLangStatus((prev) => ({ ...prev, [lang]: 'done' }));
        addLog(`${lang} : ${appliedCount} patch(es) appliqué(s) sur ${totalRequested}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur inconnue';
        setLangStatus((prev) => ({ ...prev, [lang]: 'error' }));
        addLog(`ERREUR ${lang} : ${message}`);
        failedLangs.push(lang);
        setWarnings((prev) => [...prev, `${lang} : ${message}`]);
      }

      setProgress(Math.round(((i + 1) / selectedLangs.length) * 100));
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

    if (!completeCalled.current && (languageStats.length > 0 || failedLangs.length < selectedLangs.length)) {
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
        {/* Section detection info */}
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
          {progress < 100 && (
            <span className="inline-block animate-pulse">_</span>
          )}
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
