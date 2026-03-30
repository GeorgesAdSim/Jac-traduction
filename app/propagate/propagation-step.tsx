'use client';

import { useState, useCallback, useRef } from 'react';
import { Loader as Loader2, CircleCheck as CheckCircle2, BookOpen, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Modification } from '@/lib/types/docx';

const AVAILABLE_LANGUAGES = [
  { code: 'FR', name: 'Français' },
  { code: 'EN', name: 'Anglais' },
  { code: 'DE', name: 'Allemand' },
  { code: 'NL', name: 'Néerlandais' },
  { code: 'ES', name: 'Espagnol' },
  { code: 'IT', name: 'Italien' },
  { code: 'PL', name: 'Polonais' },
  { code: 'AR', name: 'Arabe' },
];

export interface LanguageResult {
  language: string;
  modifications: Array<Modification & { translatedText?: string; status: string }>;
  stats: { translated: number; deleted: number; total: number };
}

interface PropagationStepProps {
  modifications?: Modification[];
  sourceLang?: string;
  onComplete: (results: LanguageResult[]) => void;
}

export function PropagationStep({
  modifications,
  sourceLang = 'FR',
  onComplete,
}: PropagationStepProps) {
  const [selectedLangs, setSelectedLangs] = useState<string[]>(['EN', 'DE', 'NL', 'ES']);
  const [useGlossary, setUseGlossary] = useState(true);
  const [started, setStarted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [langStatus, setLangStatus] = useState<Record<string, 'pending' | 'active' | 'done' | 'error'>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const completeCalled = useRef(false);

  const targetLangs = AVAILABLE_LANGUAGES.filter(
    (l) => l.code !== sourceLang
  );

  const toggleLang = (code: string) => {
    setSelectedLangs((prev) =>
      prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code]
    );
  };

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg]);
  }, []);

  const startPropagation = useCallback(async () => {
    if (!modifications || selectedLangs.length === 0) return;

    setStarted(true);
    setProgress(0);
    const initialStatus: Record<string, 'pending'> = {};
    for (const lang of selectedLangs) initialStatus[lang] = 'pending';
    setLangStatus(initialStatus);
    addLog('Initialisation du traitement...');

    const allResults: LanguageResult[] = [];
    const failedLangs: string[] = [];

    for (let i = 0; i < selectedLangs.length; i++) {
      const lang = selectedLangs[i];
      setLangStatus((prev) => ({ ...prev, [lang]: 'active' }));
      addLog(`Traitement ${lang} en cours...`);

      try {
        const res = await fetch('/api/propagate/language', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modifications,
            targetLang: lang,
            useGlossary,
            sourceLang,
          }),
        });

        const text = await res.text();
        let data: LanguageResult;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`Réponse invalide du serveur (${res.status})`);
        }

        if (!res.ok) {
          throw new Error((data as unknown as { error: string }).error || `Erreur ${res.status}`);
        }

        allResults.push(data);
        setLangStatus((prev) => ({ ...prev, [lang]: 'done' }));
        addLog(`Traitement ${lang} : ${data.stats.translated} traduite(s), ${data.stats.deleted} supprimée(s)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur inconnue';
        setLangStatus((prev) => ({ ...prev, [lang]: 'error' }));
        addLog(`ERREUR ${lang} : ${message}`);
        failedLangs.push(lang);
        setWarnings((prev) => [...prev, `${lang} : ${message}`]);
      }

      const pct = Math.round(((i + 1) / selectedLangs.length) * 100);
      setProgress(pct);
    }

    if (failedLangs.length > 0 && failedLangs.length < selectedLangs.length) {
      addLog(`Propagation terminée avec ${failedLangs.length} erreur(s)`);
    } else if (failedLangs.length === 0) {
      addLog('Vérification de cohérence...');
      addLog('Propagation terminée avec succès');
    } else {
      addLog('Propagation échouée pour toutes les langues');
    }

    setProgress(100);

    if (allResults.length > 0 && !completeCalled.current) {
      completeCalled.current = true;
      setTimeout(() => onComplete(allResults), 800);
    }
  }, [modifications, selectedLangs, useGlossary, sourceLang, addLog, onComplete]);

  if (!started) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
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
          disabled={selectedLangs.length === 0}
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
