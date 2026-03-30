'use client';

import { Download, CircleCheck as CheckCircle2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface LanguageResult {
  language: string;
  modifications: unknown[];
  stats: { translated: number; deleted: number; total: number };
}

interface DownloadStepProps {
  results?: LanguageResult[];
  filename?: string;
}

export function DownloadStep({ results, filename }: DownloadStepProps) {
  const languages = results?.map((r) => r.language) ?? [];
  const totalMods = results?.[0]?.stats.total ?? 0;

  const handleDownload = (lang: string) => {
    const result = results?.find((r) => r.language === lang);
    if (!result) return;

    const content = JSON.stringify(result, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `propagation_${lang}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Résultat ${lang} téléchargé`);
  };

  const handleDownloadAll = () => {
    if (!results) return;
    const content = JSON.stringify(results, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'propagation_all.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Tous les résultats téléchargés');
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded border border-green-200 bg-green-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
        <h3 className="mt-4 text-lg font-bold text-jac-dark">
          Propagation terminée
        </h3>
        <p className="mt-2 text-sm text-jac-text-secondary">
          {totalMods} modification{totalMods > 1 ? 's' : ''} propagée{totalMods > 1 ? 's' : ''} dans {languages.length} langue{languages.length > 1 ? 's' : ''} ({languages.join(', ')})
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <h4 className="text-sm font-semibold text-jac-dark">Résultats par langue</h4>
        {(results ?? []).map((result) => (
          <div
            key={result.language}
            className="flex items-center justify-between rounded border border-border bg-white px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-jac-text-secondary" />
              <div>
                <span className="text-sm font-medium text-jac-dark">
                  {filename ? filename.replace('.docx', `_${result.language}.docx`) : `Résultat_${result.language}`}
                </span>
                <p className="text-xs text-jac-text-secondary">
                  {result.stats.translated} traduite(s), {result.stats.deleted} supprimée(s)
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownload(result.language)}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Télécharger
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-center">
        <Button onClick={handleDownloadAll}>
          <Download className="mr-2 h-4 w-4" />
          Télécharger tout
        </Button>
      </div>
    </div>
  );
}
