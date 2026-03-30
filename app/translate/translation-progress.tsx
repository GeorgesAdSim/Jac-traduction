'use client';

import { useEffect, useRef } from 'react';
import { Loader as Loader2 } from 'lucide-react';

interface TranslationProgressProps {
  sourceLang: string;
  targetLang: string;
  file: File | null;
  useGlossary: boolean;
  progress: number;
  onProgress: (pct: number) => void;
  onComplete: (blob: Blob, filename: string) => void;
  onError: (message: string) => void;
}

export function TranslationProgress({
  sourceLang,
  targetLang,
  file,
  useGlossary,
  progress,
  onProgress,
  onComplete,
  onError,
}: TranslationProgressProps) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || !file) return;
    startedRef.current = true;

    const doTranslate = async () => {
      try {
        onProgress(10);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('sourceLang', sourceLang);
        formData.append('targetLang', targetLang);
        formData.append('useGlossary', String(useGlossary));

        onProgress(30);

        const res = await fetch('/api/translate', {
          method: 'POST',
          body: formData,
        });

        onProgress(70);

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Erreur de traduction');
        }

        onProgress(90);

        const blob = await res.blob();
        const disposition = res.headers.get('Content-Disposition') || '';
        const filenameMatch = disposition.match(/filename="(.+?)"/);
        const outputFilename = filenameMatch
          ? filenameMatch[1]
          : file.name.replace('.docx', `_${targetLang}.docx`);

        onProgress(100);

        setTimeout(() => onComplete(blob, outputFilename), 500);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur de traduction';
        onError(message);
      }
    };

    doTranslate();
  }, [file, sourceLang, targetLang, useGlossary, onProgress, onComplete, onError]);

  const remainingSeconds = Math.max(0, Math.ceil(((100 - progress) / 100) * 30));

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
