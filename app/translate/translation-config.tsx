'use client';

import { useState } from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TranslationConfigProps {
  sourceLang: string;
  targetLang: string;
  onSourceChange: (lang: string) => void;
  onTargetChange: (lang: string) => void;
  onStart: (useGlossary: boolean) => void;
}

const LANGUAGES = [
  { code: 'FR', label: 'Français' },
  { code: 'EN', label: 'Anglais' },
  { code: 'DE', label: 'Allemand' },
  { code: 'NL', label: 'Néerlandais' },
  { code: 'ES', label: 'Espagnol' },
  { code: 'IT', label: 'Italien' },
  { code: 'RU', label: 'Russe' },
  { code: 'PL', label: 'Polonais' },
  { code: 'AR', label: 'Arabe' },
];

export function TranslationConfig({
  sourceLang,
  targetLang,
  onSourceChange,
  onTargetChange,
  onStart,
}: TranslationConfigProps) {
  const [useGlossary, setUseGlossary] = useState(true);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded border border-border bg-white p-6">
        <h3 className="mb-6 text-sm font-semibold text-jac-dark">
          Configuration de la traduction
        </h3>

        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-jac-text-secondary">
              Langue source
            </label>
            <select
              value={sourceLang}
              onChange={(e) => onSourceChange(e.target.value)}
              className="w-full rounded border border-border bg-white px-3 py-2.5 text-sm text-jac-dark outline-none focus:border-jac-red focus:ring-1 focus:ring-jac-red"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.code})
                </option>
              ))}
            </select>
          </div>

          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center self-end">
            <ArrowRight className="h-5 w-5 text-jac-text-secondary" />
          </div>

          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-jac-text-secondary">
              Langue cible
            </label>
            <select
              value={targetLang}
              onChange={(e) => onTargetChange(e.target.value)}
              className="w-full rounded border border-border bg-white px-3 py-2.5 text-sm text-jac-dark outline-none focus:border-jac-red focus:ring-1 focus:ring-jac-red"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.code})
                </option>
              ))}
            </select>
          </div>
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
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors ${
              useGlossary ? 'bg-jac-red' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
                useGlossary ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      <Button
        onClick={() => onStart(useGlossary)}
        disabled={sourceLang === targetLang}
        className="w-full"
      >
        Lancer la traduction
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
