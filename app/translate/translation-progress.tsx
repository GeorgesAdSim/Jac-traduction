'use client';

import { useEffect, useState } from 'react';
import { Loader as Loader2 } from 'lucide-react';

interface TranslationProgressProps {
  sourceLang: string;
  targetLang: string;
  onComplete: () => void;
}

export function TranslationProgress({
  sourceLang,
  targetLang,
  onComplete,
}: TranslationProgressProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + 1;
      });
    }, 60);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (progress >= 100) {
      const timeout = setTimeout(onComplete, 500);
      return () => clearTimeout(timeout);
    }
  }, [progress, onComplete]);

  const remainingSeconds = Math.max(0, Math.ceil(((100 - progress) / 100) * 6));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded border border-border bg-white p-8 text-center">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-jac-red" />
        <h3 className="mt-4 text-lg font-bold text-jac-dark">
          Traduction en cours...
        </h3>
        <p className="mt-1 text-sm text-jac-text-secondary">
          {sourceLang} → {targetLang}
        </p>

        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-jac-text-secondary">Progression</span>
            <span className="font-mono font-medium text-jac-dark">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-jac-bg-alt">
            <div
              className="h-full rounded-full bg-jac-red transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-jac-text-secondary">
            Temps restant estimé : ~{remainingSeconds}s
          </p>
        </div>
      </div>
    </div>
  );
}
