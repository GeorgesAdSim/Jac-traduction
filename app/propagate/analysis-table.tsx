'use client';

import { cn } from '@/lib/utils';
import type { AnalysisResult, ModificationType } from '@/lib/types/docx';

interface AnalysisTableProps {
  result: AnalysisResult | null;
}

const TYPE_CONFIG: Record<
  ModificationType,
  { badge: string; dot: string; label: string; action: string }
> = {
  DELETE: {
    badge: 'bg-red-100 text-red-700',
    dot: 'bg-red-500',
    label: 'Rouge',
    action: 'Supprimer',
  },
  MODIFY: {
    badge: 'bg-blue-100 text-blue-700',
    dot: 'bg-blue-500',
    label: 'Bleu',
    action: 'Modifier',
  },
  ADD: {
    badge: 'bg-green-100 text-green-700',
    dot: 'bg-green-500',
    label: 'Vert',
    action: 'Ajouter',
  },
  NONE: {
    badge: 'bg-gray-100 text-gray-700',
    dot: 'bg-gray-500',
    label: 'Aucun',
    action: '-',
  },
};

export function AnalysisTable({ result }: AnalysisTableProps) {
  if (!result || result.modifications.length === 0) {
    return (
      <div className="rounded border border-border p-8 text-center text-sm text-jac-text-secondary">
        Aucune modification détectée dans le document.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-jac-text-secondary">
        <span>{result.totalParagraphs} paragraphes analysés</span>
        <span className="text-red-600">{result.summary.deletions} suppression{result.summary.deletions > 1 ? 's' : ''}</span>
        <span className="text-blue-600">{result.summary.modifications} modification{result.summary.modifications > 1 ? 's' : ''}</span>
        <span className="text-green-600">{result.summary.additions} ajout{result.summary.additions > 1 ? 's' : ''}</span>
      </div>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-jac-bg-alt">
              <th className="px-4 py-3 text-left font-semibold text-jac-dark">
                Texte original
              </th>
              <th className="px-4 py-3 text-left font-semibold text-jac-dark">
                Couleur
              </th>
              <th className="px-4 py-3 text-left font-semibold text-jac-dark">
                Action
              </th>
              <th className="px-4 py-3 text-left font-semibold text-jac-dark">
                Contexte
              </th>
            </tr>
          </thead>
          <tbody>
            {result.modifications.map((mod) => {
              const config = TYPE_CONFIG[mod.type];
              return (
                <tr key={mod.id} className="border-b border-border last:border-0">
                  <td className="max-w-xs px-4 py-3 text-jac-text">
                    {mod.originalText || (
                      <span className="italic text-jac-text-secondary">
                        (Nouveau contenu)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                        config.badge
                      )}
                    >
                      <span className={cn('h-2 w-2 rounded-full', config.dot)} />
                      {config.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-jac-dark">
                    {config.action}
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-jac-text-secondary">
                    {mod.context}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
