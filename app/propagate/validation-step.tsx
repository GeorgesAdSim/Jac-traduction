'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Modification } from '@/lib/types/docx';

interface ValidationStepProps {
  modifications?: Modification[];
  onContinue: (selectedIds: string[]) => void;
}

const DOT_COLORS = {
  DELETE: 'bg-red-500',
  MODIFY: 'bg-blue-500',
  ADD: 'bg-green-500',
  NONE: 'bg-gray-500',
};

const ACTION_LABELS = {
  DELETE: 'Supprimer',
  MODIFY: 'Modifier',
  ADD: 'Ajouter',
  NONE: '-',
};

export function ValidationStep({ modifications, onContinue }: ValidationStepProps) {
  const items = modifications ?? [];
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const mod of items) {
      initial[mod.id] = true;
    }
    return initial;
  });

  const toggle = (id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedCount = Object.values(checked).filter(Boolean).length;

  const handleContinue = () => {
    const selectedIds = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([k]) => k);
    onContinue(selectedIds);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded border border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-jac-dark">
            Validez les modifications à propager
          </h3>
          <p className="mt-0.5 text-xs text-jac-text-secondary">
            {selectedCount} sur {items.length} sélectionnées
          </p>
        </div>
        <div className="divide-y divide-border">
          {items.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-jac-bg-alt/50"
            >
              <input
                type="checkbox"
                checked={checked[item.id] ?? false}
                onChange={() => toggle(item.id)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-jac-red"
              />
              <div className="flex items-center gap-2">
                <span className={cn('h-2.5 w-2.5 rounded-full', DOT_COLORS[item.type])} />
                <span className="text-sm text-jac-text">
                  {ACTION_LABELS[item.type]} : &quot;{item.originalText}&quot;
                </span>
              </div>
            </label>
          ))}
          {items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-jac-text-secondary">
              Aucune modification à valider
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={handleContinue}
          disabled={selectedCount === 0}
          className="w-full sm:w-auto"
        >
          Lancer la propagation
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
