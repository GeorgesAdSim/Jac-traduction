'use client';

import { useState } from 'react';
import { Search, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface GlossaryEntry {
  id: number;
  source: string;
  sourceLang: string;
  translation: string;
  targetLang: string;
  validated: boolean;
}

const INITIAL_DATA: GlossaryEntry[] = [
  { id: 1, source: 'Stepper motor', sourceLang: 'EN', translation: 'Moteur pas-à-pas', targetLang: 'FR', validated: true },
  { id: 2, source: 'Blade fault', sourceLang: 'EN', translation: 'Défaut lame', targetLang: 'FR', validated: true },
  { id: 3, source: 'Dough divider', sourceLang: 'EN', translation: 'Diviseur de pâte', targetLang: 'FR', validated: false },
  { id: 4, source: 'Conveyor belt', sourceLang: 'EN', translation: 'Tapis roulant', targetLang: 'FR', validated: true },
  { id: 5, source: 'Proof chamber', sourceLang: 'EN', translation: 'Chambre de pousse', targetLang: 'FR', validated: false },
];

const LANGUAGES = ['Toutes', 'FR', 'EN', 'DE', 'NL', 'ES', 'IT'];

export default function GlossaryPage() {
  const [entries, setEntries] = useState<GlossaryEntry[]>(INITIAL_DATA);
  const [search, setSearch] = useState('');
  const [langFilter, setLangFilter] = useState('Toutes');

  const filtered = entries.filter((e) => {
    const matchSearch =
      e.source.toLowerCase().includes(search.toLowerCase()) ||
      e.translation.toLowerCase().includes(search.toLowerCase());
    const matchLang =
      langFilter === 'Toutes' ||
      e.sourceLang === langFilter ||
      e.targetLang === langFilter;
    return matchSearch && matchLang;
  });

  const handleAdd = () => {
    toast.success('Formulaire d\'ajout ouvert (simulation)');
  };

  const handleEdit = (id: number) => {
    toast.info(`Édition du terme #${id} (simulation)`);
  };

  const handleDelete = (id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    toast.success('Terme supprimé');
  };

  return (
    <div className="bg-white px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-jac-dark">
              Glossaire technique
            </h1>
            <p className="mt-1 text-sm text-jac-text-secondary">
              {entries.length} termes enregistrés
            </p>
          </div>
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Ajouter un terme
          </Button>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-jac-text-secondary" />
            <input
              type="text"
              placeholder="Rechercher un terme..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded border border-border bg-white py-2.5 pl-10 pr-4 text-sm text-jac-dark outline-none placeholder:text-jac-text-secondary focus:border-jac-red focus:ring-1 focus:ring-jac-red"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                onClick={() => setLangFilter(lang)}
                className={cn(
                  'flex-shrink-0 rounded px-3 py-2 text-xs font-medium transition-colors',
                  langFilter === lang
                    ? 'bg-jac-dark text-white'
                    : 'bg-jac-bg-alt text-jac-text-secondary hover:bg-gray-200'
                )}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-jac-bg-alt">
                <th className="px-4 py-3 text-left font-semibold text-jac-dark">
                  Terme source
                </th>
                <th className="px-4 py-3 text-left font-semibold text-jac-dark">
                  Langue
                </th>
                <th className="px-4 py-3 text-left font-semibold text-jac-dark">
                  Traduction
                </th>
                <th className="px-4 py-3 text-left font-semibold text-jac-dark">
                  Langue
                </th>
                <th className="px-4 py-3 text-left font-semibold text-jac-dark">
                  Statut
                </th>
                <th className="px-4 py-3 text-right font-semibold text-jac-dark">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-border last:border-0 hover:bg-jac-bg-alt/50"
                >
                  <td className="px-4 py-3 font-medium text-jac-dark">
                    {entry.source}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-jac-bg-alt px-2 py-0.5 text-xs font-medium text-jac-text-secondary">
                      {entry.sourceLang}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-jac-text">
                    {entry.translation}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-jac-bg-alt px-2 py-0.5 text-xs font-medium text-jac-text-secondary">
                      {entry.targetLang}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                        entry.validated
                          ? 'bg-green-100 text-green-700'
                          : 'bg-orange-100 text-orange-700'
                      )}
                    >
                      {entry.validated ? (
                        <>
                          <Check className="h-3 w-3" /> Validé
                        </>
                      ) : (
                        <>
                          <X className="h-3 w-3" /> En attente
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => handleEdit(entry.id)}
                        className="rounded p-1.5 text-jac-text-secondary transition-colors hover:bg-jac-bg-alt hover:text-jac-dark"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="rounded p-1.5 text-jac-text-secondary transition-colors hover:bg-red-50 hover:text-jac-red"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-jac-text-secondary">
                    Aucun terme trouvé
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
