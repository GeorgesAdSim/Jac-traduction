'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  FileText,
  BookOpen,
  Globe,
  Zap,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface KpiCard {
  label: string;
  value: string;
  icon: React.ReactNode;
  change?: string;
}

const KPI_CARDS: KpiCard[] = [
  { label: 'Documents traités', value: '247', icon: <FileText className="h-5 w-5" />, change: '+12 ce mois' },
  { label: 'Termes glossaire', value: '1,842', icon: <BookOpen className="h-5 w-5" />, change: '+38 ce mois' },
  { label: 'Langues actives', value: '9', icon: <Globe className="h-5 w-5" /> },
  { label: 'Crédits API restants', value: '8,450', icon: <Zap className="h-5 w-5" />, change: '85% du quota' },
];

interface Language {
  code: string;
  name: string;
  enabled: boolean;
}

const INITIAL_LANGUAGES: Language[] = [
  { code: 'FR', name: 'Français', enabled: true },
  { code: 'EN', name: 'Anglais', enabled: true },
  { code: 'DE', name: 'Allemand', enabled: true },
  { code: 'NL', name: 'Néerlandais', enabled: true },
  { code: 'ES', name: 'Espagnol', enabled: true },
  { code: 'IT', name: 'Italien', enabled: true },
  { code: 'RU', name: 'Russe', enabled: false },
  { code: 'PL', name: 'Polonais', enabled: true },
  { code: 'AR', name: 'Arabe', enabled: true },
];

interface HistoryEntry {
  id: number;
  date: string;
  document: string;
  mode: 'Propagation' | 'Traduction';
  languages: string;
  status: 'success' | 'pending' | 'error';
}

const HISTORY: HistoryEntry[] = [
  { id: 1, date: '2026-03-30', document: 'Manuel_JAC_v4.2.docx', mode: 'Propagation', languages: 'FR, DE, NL, EN', status: 'success' },
  { id: 2, date: '2026-03-29', document: 'Guide_maintenance.docx', mode: 'Traduction', languages: 'FR → EN', status: 'success' },
  { id: 3, date: '2026-03-28', document: 'Fiche_securite.docx', mode: 'Propagation', languages: 'FR, DE, ES', status: 'success' },
  { id: 4, date: '2026-03-28', document: 'Catalogue_pieces.docx', mode: 'Traduction', languages: 'FR → DE', status: 'pending' },
  { id: 5, date: '2026-03-27', document: 'Notice_diviseuse.docx', mode: 'Traduction', languages: 'FR → AR', status: 'error' },
];

const STATUS_CONFIG = {
  success: { label: 'Terminé', className: 'bg-green-100 text-green-700' },
  pending: { label: 'En cours', className: 'bg-orange-100 text-orange-700' },
  error: { label: 'Erreur', className: 'bg-red-100 text-red-700' },
};

export default function AdminPage() {
  const [languages, setLanguages] = useState<Language[]>(INITIAL_LANGUAGES);

  const toggleLanguage = (code: string) => {
    setLanguages((prev) =>
      prev.map((l) =>
        l.code === code ? { ...l, enabled: !l.enabled } : l
      )
    );
    const lang = languages.find((l) => l.code === code);
    if (lang) {
      toast.success(
        `${lang.name} ${lang.enabled ? 'désactivé' : 'activé'}`
      );
    }
  };

  return (
    <div className="bg-jac-bg-alt px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-2 text-2xl font-bold text-jac-dark">
          Administration
        </h1>
        <p className="mb-8 text-sm text-jac-text-secondary">
          Tableau de bord et configuration de DocPropag
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {KPI_CARDS.map((kpi) => (
            <div
              key={kpi.label}
              className="rounded border border-border bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-jac-text-secondary">
                  {kpi.label}
                </span>
                <div className="text-jac-text-secondary">{kpi.icon}</div>
              </div>
              <p className="mt-2 text-2xl font-bold text-jac-dark">{kpi.value}</p>
              {kpi.change && (
                <p className="mt-1 text-xs text-jac-text-secondary">{kpi.change}</p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 rounded border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-jac-dark">Langues</h2>
              <p className="mt-0.5 text-xs text-jac-text-secondary">
                {languages.filter((l) => l.enabled).length} langues actives
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info('Ajout de langue (simulation)')}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Ajouter
            </Button>
          </div>
          <div className="grid gap-0 divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
            {languages.map((lang) => (
              <div
                key={lang.code}
                className="flex items-center justify-between border-b border-border px-5 py-3 sm:border-r sm:last:border-r-0"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded bg-jac-bg-alt text-xs font-bold text-jac-dark">
                    {lang.code}
                  </span>
                  <span className="text-sm text-jac-dark">{lang.name}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={lang.enabled}
                  onClick={() => toggleLanguage(lang.code)}
                  className={cn(
                    'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors',
                    lang.enabled ? 'bg-jac-red' : 'bg-gray-300'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform',
                      lang.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 rounded border border-border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-jac-dark">Historique</h2>
            <p className="mt-0.5 text-xs text-jac-text-secondary">
              Derniers documents traités
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-jac-bg-alt">
                  <th className="px-5 py-3 text-left font-semibold text-jac-dark">
                    Date
                  </th>
                  <th className="px-5 py-3 text-left font-semibold text-jac-dark">
                    Document
                  </th>
                  <th className="px-5 py-3 text-left font-semibold text-jac-dark">
                    Mode
                  </th>
                  <th className="px-5 py-3 text-left font-semibold text-jac-dark">
                    Langues
                  </th>
                  <th className="px-5 py-3 text-left font-semibold text-jac-dark">
                    Statut
                  </th>
                </tr>
              </thead>
              <tbody>
                {HISTORY.map((entry) => {
                  const status = STATUS_CONFIG[entry.status];
                  return (
                    <tr
                      key={entry.id}
                      className="border-b border-border last:border-0 hover:bg-jac-bg-alt/50"
                    >
                      <td className="whitespace-nowrap px-5 py-3 text-jac-text-secondary">
                        {entry.date}
                      </td>
                      <td className="px-5 py-3 font-medium text-jac-dark">
                        {entry.document}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            'rounded px-2 py-0.5 text-xs font-medium',
                            entry.mode === 'Propagation'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-teal-100 text-teal-700'
                          )}
                        >
                          {entry.mode}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-jac-text-secondary">
                        {entry.languages}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-0.5 text-xs font-medium',
                            status.className
                          )}
                        >
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
