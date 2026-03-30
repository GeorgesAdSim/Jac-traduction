'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ValidationStepProps {
  onContinue: () => void;
}

const ITEMS = [
  {
    id: 1,
    text: 'Supprimer : "La vitesse de rotation du moteur pas-à-pas est de 200 tr/min"',
    color: 'red' as const,
  },
  {
    id: 2,
    text: 'Supprimer : "Le cycle de nettoyage doit être effectué manuellement"',
    color: 'red' as const,
  },
  {
    id: 3,
    text: 'Modifier : "Vérifier le capteur de défaut lame" → "...toutes les 50 heures"',
    color: 'blue' as const,
  },
  {
    id: 4,
    text: 'Modifier : "Température maximale du four : 250°C" → "...280°C (nouveau modèle)"',
    color: 'blue' as const,
  },
  {
    id: 5,
    text: 'Ajouter : "ATTENTION : Ne jamais dépasser 85°C lors du préchauffage du diviseur"',
    color: 'green' as const,
  },
  {
    id: 6,
    text: 'Ajouter : "Le diviseur de pâte doit être calibré après chaque changement de lame"',
    color: 'green' as const,
  },
];

const DOT_COLORS = {
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  green: 'bg-green-500',
};

export function ValidationStep({ onContinue }: ValidationStepProps) {
  const [checked, setChecked] = useState<Record<number, boolean>>({
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
  });

  const toggle = (id: number) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded border border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-jac-dark">
            Validez les modifications à propager
          </h3>
          <p className="mt-0.5 text-xs text-jac-text-secondary">
            {selectedCount} sur {ITEMS.length} sélectionnées
          </p>
        </div>
        <div className="divide-y divide-border">
          {ITEMS.map((item) => (
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
                <span className={cn('h-2.5 w-2.5 rounded-full', DOT_COLORS[item.color])} />
                <span className="text-sm text-jac-text">{item.text}</span>
              </div>
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={onContinue}
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
