'use client';

import { cn } from '@/lib/utils';

const MOCK_DATA = [
  {
    id: 1,
    original: 'La vitesse de rotation du moteur pas-à-pas est de 200 tr/min',
    color: 'red' as const,
    action: 'Supprimer',
    preview: '(Paragraphe supprimé dans toutes les langues)',
  },
  {
    id: 2,
    original: 'Le cycle de nettoyage doit être effectué manuellement',
    color: 'red' as const,
    action: 'Supprimer',
    preview: '(Paragraphe supprimé dans toutes les langues)',
  },
  {
    id: 3,
    original: 'Vérifier le capteur de défaut lame avant chaque utilisation',
    color: 'blue' as const,
    action: 'Modifier',
    preview: 'Vérifier le capteur de défaut lame toutes les 50 heures',
  },
  {
    id: 4,
    original: 'Température maximale du four : 250°C',
    color: 'blue' as const,
    action: 'Modifier',
    preview: 'Température maximale du four : 280°C (nouveau modèle)',
  },
  {
    id: 5,
    original: '',
    color: 'green' as const,
    action: 'Ajouter',
    preview: 'ATTENTION : Ne jamais dépasser 85°C lors du préchauffage du diviseur',
  },
  {
    id: 6,
    original: '',
    color: 'green' as const,
    action: 'Ajouter',
    preview: 'Le diviseur de pâte doit être calibré après chaque changement de lame',
  },
];

const COLOR_CONFIG = {
  red: { badge: 'bg-red-100 text-red-700', dot: 'bg-red-500', label: 'Rouge' },
  blue: { badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500', label: 'Bleu' },
  green: { badge: 'bg-green-100 text-green-700', dot: 'bg-green-500', label: 'Vert' },
};

export function AnalysisTable() {
  return (
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
              Aperçu traduction
            </th>
          </tr>
        </thead>
        <tbody>
          {MOCK_DATA.map((row) => {
            const config = COLOR_CONFIG[row.color];
            return (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-jac-text">
                  {row.original || (
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
                  {row.action}
                </td>
                <td className="px-4 py-3 text-jac-text-secondary">
                  {row.preview}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
