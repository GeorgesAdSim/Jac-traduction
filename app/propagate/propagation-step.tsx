'use client';

import { useEffect, useState } from 'react';
import { Loader as Loader2, CircleCheck as CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PropagationStepProps {
  onComplete: () => void;
}

const LANGUAGES = [
  { code: 'FR', name: 'Français' },
  { code: 'DE', name: 'Allemand' },
  { code: 'NL', name: 'Néerlandais' },
  { code: 'ES', name: 'Espagnol' },
  { code: 'EN', name: 'Anglais' },
];

const LOG_ENTRIES = [
  'Initialisation du traitement...',
  'Traitement FR : 6 modifications appliquées',
  'Traitement DE : 6 modifications propagées',
  'Traitement NL : 6 modifications propagées',
  'Traitement ES : 6 modifications propagées',
  'Traitement EN : 6 modifications propagées',
  'Vérification de cohérence...',
  'Propagation terminée avec succès',
];

export function PropagationStep({ onComplete }: PropagationStepProps) {
  const [progress, setProgress] = useState(0);
  const [currentLang, setCurrentLang] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + 2;
      });
    }, 80);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (progress >= 20 && currentLang < 1) setCurrentLang(1);
    if (progress >= 40 && currentLang < 2) setCurrentLang(2);
    if (progress >= 60 && currentLang < 3) setCurrentLang(3);
    if (progress >= 80 && currentLang < 4) setCurrentLang(4);
    if (progress >= 100) onComplete();
  }, [progress, currentLang, onComplete]);

  useEffect(() => {
    const logIndex = Math.min(
      Math.floor((progress / 100) * LOG_ENTRIES.length),
      LOG_ENTRIES.length
    );
    setLogs(LOG_ENTRIES.slice(0, logIndex));
  }, [progress]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-jac-dark">Propagation en cours...</span>
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
        {LANGUAGES.map((lang, i) => {
          const done = i < currentLang || progress >= 100;
          const active = i === currentLang && progress < 100;
          return (
            <div
              key={lang.code}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded border px-2 py-2.5 text-sm font-medium transition-colors sm:px-3',
                done && 'border-green-200 bg-green-50 text-green-700',
                active && 'border-jac-red/30 bg-red-50 text-jac-red',
                !done && !active && 'border-border bg-white text-jac-text-secondary'
              )}
            >
              {done ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : active ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {lang.code}
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
    </div>
  );
}
