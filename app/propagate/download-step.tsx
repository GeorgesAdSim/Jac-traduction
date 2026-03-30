'use client';

import { Download, CircleCheck as CheckCircle2, FileText, FileSpreadsheet, Braces } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { LanguageResult } from './propagation-step';

interface DownloadStepProps {
  results?: LanguageResult[];
  filename?: string;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function generateCSV(results: LanguageResult[]): string {
  if (results.length === 0) return '';

  const languages = results.map((r) => r.language);
  const headers = ['Type', 'Texte original', ...languages];

  // Build rows from first result's modifications (all results have same source mods)
  const firstResult = results[0];
  const rows: string[][] = [];

  for (const mod of firstResult.modifications) {
    const row: string[] = [
      mod.status === 'deleted' ? 'Supprimer' : mod.type === 'MODIFY' ? 'Modifier' : 'Ajouter',
      mod.originalText,
    ];

    for (const langResult of results) {
      const match = langResult.modifications.find((m) => m.id === mod.id);
      if (!match) {
        row.push('');
      } else if (match.status === 'deleted') {
        row.push('[SUPPRIMÉ]');
      } else {
        row.push(match.translatedText || '');
      }
    }

    rows.push(row);
  }

  const escape = (val: string) => {
    if (val.includes('"') || val.includes(',') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const csvLines = [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ];

  return '\uFEFF' + csvLines.join('\n');
}

export function DownloadStep({ results, filename }: DownloadStepProps) {
  const languages = results?.map((r) => r.language) ?? [];
  const totalMods = results?.[0]?.stats.total ?? 0;

  const handleDownloadCSV = () => {
    if (!results) return;
    const csv = generateCSV(results);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const name = filename
      ? filename.replace('.docx', '_propagation.csv')
      : 'propagation_rapport.csv';
    downloadBlob(blob, name);
    toast.success('Rapport CSV téléchargé');
  };

  const handleDownloadJSON = () => {
    if (!results) return;
    const content = JSON.stringify(results, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const name = filename
      ? filename.replace('.docx', '_propagation.json')
      : 'propagation_rapport.json';
    downloadBlob(blob, name);
    toast.success('Rapport JSON téléchargé');
  };

  const handleDownloadLang = (lang: string) => {
    const result = results?.find((r) => r.language === lang);
    if (!result) return;
    const content = JSON.stringify(result, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    downloadBlob(blob, `propagation_${lang}.json`);
    toast.success(`Résultat ${lang} téléchargé`);
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

      {/* Rapport téléchargeable */}
      <div className="mt-6 flex gap-3">
        <Button onClick={handleDownloadCSV} className="flex-1">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Rapport CSV
        </Button>
        <Button onClick={handleDownloadJSON} variant="outline" className="flex-1">
          <Braces className="mr-2 h-4 w-4" />
          Rapport JSON
        </Button>
      </div>

      {/* Résultats par langue */}
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
                  {result.language}
                </span>
                <p className="text-xs text-jac-text-secondary">
                  {result.stats.translated} traduite(s), {result.stats.deleted} supprimée(s)
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownloadLang(result.language)}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              JSON
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
