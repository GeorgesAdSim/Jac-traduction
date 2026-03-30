'use client';

import { Download, CircleCheck as CheckCircle2, FileText, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface TranslationResultProps {
  sourceLang: string;
  targetLang: string;
}

const PREVIEW_LINES = [
  { source: 'Moteur pas-à-pas', target: 'Stepper motor' },
  { source: 'Défaut lame', target: 'Blade fault' },
  { source: 'Diviseur de pâte', target: 'Dough divider' },
  { source: 'Vitesse de rotation', target: 'Rotation speed' },
  { source: 'Capteur de température', target: 'Temperature sensor' },
];

export function TranslationResult({ sourceLang, targetLang }: TranslationResultProps) {
  const handleDownload = () => {
    toast.success('Téléchargement lancé (simulation)');
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded border border-green-200 bg-green-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
        <h3 className="mt-4 text-lg font-bold text-jac-dark">
          Traduction terminée
        </h3>
        <p className="mt-2 text-sm text-jac-text-secondary">
          Document traduit de {sourceLang} vers {targetLang} avec succès
        </p>
      </div>

      <div className="rounded border border-border bg-white">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Eye className="h-4 w-4 text-jac-text-secondary" />
          <span className="text-sm font-semibold text-jac-dark">
            Aperçu de la traduction
          </span>
        </div>
        <div className="divide-y divide-border">
          {PREVIEW_LINES.map((line) => (
            <div key={line.source} className="grid grid-cols-2 gap-4 px-4 py-3">
              <div>
                <span className="text-xs text-jac-text-secondary">{sourceLang}</span>
                <p className="text-sm text-jac-dark">{line.source}</p>
              </div>
              <div>
                <span className="text-xs text-jac-text-secondary">{targetLang}</span>
                <p className="text-sm font-medium text-jac-dark">{line.target}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded border border-border bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-jac-text-secondary" />
          <div>
            <p className="text-sm font-medium text-jac-dark">
              Document_traduit_{targetLang}.docx
            </p>
            <p className="text-xs text-jac-text-secondary">142 Ko</p>
          </div>
        </div>
        <Button onClick={handleDownload}>
          <Download className="mr-2 h-4 w-4" />
          Télécharger
        </Button>
      </div>
    </div>
  );
}
