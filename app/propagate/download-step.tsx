'use client';

import { Download, CircleCheck as CheckCircle2, FileText, FileSpreadsheet, Braces } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { PropagationResult } from './propagation-step';
import type { LanguageResult } from './propagation-step';

interface DownloadStepProps {
  propagationResult?: PropagationResult;
  file?: File | null;
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

export function DownloadStep({ propagationResult, file, filename }: DownloadStepProps) {
  const results = propagationResult?.legacyResults ?? [];
  const langStats = propagationResult?.languageStats ?? [];
  const totalLangs = langStats.length;
  const totalModifiedParas = langStats.reduce((acc, s) => acc + s.modifiedParagraphs, 0);

  const handleDownloadDocx = async () => {
    if (!propagationResult?.modifiedDocumentXml || !file) {
      toast.error('Document non disponible');
      return;
    }

    try {
      const { rebuildDocx } = await import('@/lib/docx-rebuilder');
      const blob = await rebuildDocx(file, propagationResult.modifiedDocumentXml);
      const name = filename
        ? filename.replace('.docx', '_propagated.docx')
        : 'document_propagated.docx';
      downloadBlob(blob, name);
      toast.success('Document .docx téléchargé');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      toast.error(`Erreur reconstruction : ${message}`);
    }
  };

  const handleDownloadCSV = () => {
    if (results.length === 0) return;
    const csv = generateCSV(results);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const name = filename
      ? filename.replace('.docx', '_propagation.csv')
      : 'propagation_rapport.csv';
    downloadBlob(blob, name);
    toast.success('Rapport CSV téléchargé');
  };

  const handleDownloadJSON = () => {
    if (results.length === 0) return;
    const content = JSON.stringify(results, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const name = filename
      ? filename.replace('.docx', '_propagation.json')
      : 'propagation_rapport.json';
    downloadBlob(blob, name);
    toast.success('Rapport JSON téléchargé');
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded border border-green-200 bg-green-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
        <h3 className="mt-4 text-lg font-bold text-jac-dark">
          Propagation terminée
        </h3>
        <p className="mt-2 text-sm text-jac-text-secondary">
          {totalModifiedParas} paragraphe{totalModifiedParas > 1 ? 's' : ''} modifié{totalModifiedParas > 1 ? 's' : ''} dans {totalLangs} langue{totalLangs > 1 ? 's' : ''} ({langStats.map((s) => s.language).join(', ')})
        </p>
      </div>

      {/* Primary action: download .docx */}
      <div className="mt-6">
        <Button onClick={handleDownloadDocx} className="w-full" size="lg">
          <Download className="mr-2 h-5 w-5" />
          Télécharger le document mis à jour (.docx)
        </Button>
      </div>

      {/* Secondary: reports */}
      <div className="mt-4 flex gap-3">
        <Button onClick={handleDownloadCSV} variant="outline" className="flex-1">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Rapport CSV
        </Button>
        <Button onClick={handleDownloadJSON} variant="outline" className="flex-1">
          <Braces className="mr-2 h-4 w-4" />
          Rapport JSON
        </Button>
      </div>

      {/* Per-language stats */}
      <div className="mt-6 space-y-3">
        <h4 className="text-sm font-semibold text-jac-dark">Résultats par langue</h4>
        {langStats.map((stat) => (
          <div
            key={stat.language}
            className="flex items-center justify-between rounded border border-border bg-white px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-jac-text-secondary" />
              <div>
                <span className="text-sm font-medium text-jac-dark">
                  {stat.language}
                </span>
                <p className="text-xs text-jac-text-secondary">
                  {stat.modifiedParagraphs} paragraphe(s) modifié(s) sur {stat.totalParagraphs}
                </p>
              </div>
            </div>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </div>
        ))}
      </div>
    </div>
  );
}
