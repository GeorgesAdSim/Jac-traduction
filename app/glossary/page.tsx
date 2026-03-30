'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface GlossaryEntry {
  id: string;
  source_term: string;
  source_lang: string;
  translated_term: string;
  target_lang: string;
  validated: boolean;
  client_id: string;
  created_at: string;
  updated_at: string;
}

const LANGUAGES = ['Toutes', 'FR', 'EN', 'DE', 'NL', 'ES', 'IT'];

interface TermFormData {
  source_term: string;
  source_lang: string;
  translated_term: string;
  target_lang: string;
  validated: boolean;
}

const EMPTY_FORM: TermFormData = {
  source_term: '',
  source_lang: 'EN',
  translated_term: '',
  target_lang: 'FR',
  validated: false,
};

export default function GlossaryPage() {
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [langFilter, setLangFilter] = useState('Toutes');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<TermFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchTerms = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (langFilter !== 'Toutes') params.set('sourceLang', langFilter);

      const res = await fetch(`/api/glossary?${params}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);
      setEntries(data.terms);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de chargement';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [search, langFilter]);

  useEffect(() => {
    const timeout = setTimeout(fetchTerms, 300);
    return () => clearTimeout(timeout);
  }, [fetchTerms]);

  const openAdd = () => {
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (entry: GlossaryEntry) => {
    setEditingId(entry.id);
    setFormData({
      source_term: entry.source_term,
      source_lang: entry.source_lang,
      translated_term: entry.translated_term,
      target_lang: entry.target_lang,
      validated: entry.validated,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.source_term || !formData.translated_term) {
      toast.error('Veuillez remplir tous les champs obligatoires');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        const res = await fetch(`/api/glossary/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error);
        }
        toast.success('Terme mis à jour');
      } else {
        const res = await fetch('/api/glossary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...formData, client_id: 'default' }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error);
        }
        toast.success('Terme ajouté');
      }
      setDialogOpen(false);
      fetchTerms();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de sauvegarde';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/glossary/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast.success('Terme supprimé');
      fetchTerms();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de suppression';
      toast.error(message);
    }
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
          <Button onClick={openAdd}>
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

        {loading ? (
          <div className="mt-12 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-jac-red" />
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-jac-bg-alt">
                  <th className="px-4 py-3 text-left font-semibold text-jac-dark">Terme source</th>
                  <th className="px-4 py-3 text-left font-semibold text-jac-dark">Langue</th>
                  <th className="px-4 py-3 text-left font-semibold text-jac-dark">Traduction</th>
                  <th className="px-4 py-3 text-left font-semibold text-jac-dark">Langue</th>
                  <th className="px-4 py-3 text-left font-semibold text-jac-dark">Statut</th>
                  <th className="px-4 py-3 text-right font-semibold text-jac-dark">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-border last:border-0 hover:bg-jac-bg-alt/50"
                  >
                    <td className="px-4 py-3 font-medium text-jac-dark">{entry.source_term}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-jac-bg-alt px-2 py-0.5 text-xs font-medium text-jac-text-secondary">
                        {entry.source_lang}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-jac-text">{entry.translated_term}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-jac-bg-alt px-2 py-0.5 text-xs font-medium text-jac-text-secondary">
                        {entry.target_lang}
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
                          <><Check className="h-3 w-3" /> Validé</>
                        ) : (
                          <><X className="h-3 w-3" /> En attente</>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(entry)}
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
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-jac-text-secondary">
                      Aucun terme trouvé
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dialog ajout/édition */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-jac-dark">
              {editingId ? 'Modifier le terme' : 'Ajouter un terme'}
            </h2>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-jac-text-secondary">
                  Terme source *
                </label>
                <input
                  type="text"
                  value={formData.source_term}
                  onChange={(e) => setFormData((f) => ({ ...f, source_term: e.target.value }))}
                  className="w-full rounded border border-border px-3 py-2 text-sm outline-none focus:border-jac-red focus:ring-1 focus:ring-jac-red"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-jac-text-secondary">
                    Langue source
                  </label>
                  <select
                    value={formData.source_lang}
                    onChange={(e) => setFormData((f) => ({ ...f, source_lang: e.target.value }))}
                    className="w-full rounded border border-border px-3 py-2 text-sm outline-none focus:border-jac-red"
                  >
                    {['FR', 'EN', 'DE', 'NL', 'ES', 'IT', 'RU', 'PL', 'AR'].map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-jac-text-secondary">
                    Langue cible
                  </label>
                  <select
                    value={formData.target_lang}
                    onChange={(e) => setFormData((f) => ({ ...f, target_lang: e.target.value }))}
                    className="w-full rounded border border-border px-3 py-2 text-sm outline-none focus:border-jac-red"
                  >
                    {['FR', 'EN', 'DE', 'NL', 'ES', 'IT', 'RU', 'PL', 'AR'].map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-jac-text-secondary">
                  Traduction *
                </label>
                <input
                  type="text"
                  value={formData.translated_term}
                  onChange={(e) => setFormData((f) => ({ ...f, translated_term: e.target.value }))}
                  className="w-full rounded border border-border px-3 py-2 text-sm outline-none focus:border-jac-red focus:ring-1 focus:ring-jac-red"
                />
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.validated}
                  onChange={(e) => setFormData((f) => ({ ...f, validated: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-jac-red"
                />
                <span className="text-sm text-jac-dark">Terme validé</span>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Annuler
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingId ? 'Mettre à jour' : 'Ajouter'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
