'use client';

import { Download, CircleCheck as CheckCircle2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function DownloadStep() {
  const handleDownload = () => {
    toast.success('Téléchargement lancé (simulation)');
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded border border-green-200 bg-green-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
        <h3 className="mt-4 text-lg font-bold text-jac-dark">
          Propagation terminée
        </h3>
        <p className="mt-2 text-sm text-jac-text-secondary">
          6 modifications propagées dans 5 langues (FR, DE, NL, ES, EN)
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <h4 className="text-sm font-semibold text-jac-dark">Documents générés</h4>
        {['Manuel_technique_FR.docx', 'Manuel_technique_DE.docx', 'Manuel_technique_NL.docx', 'Manuel_technique_ES.docx', 'Manuel_technique_EN.docx'].map(
          (name) => (
            <div
              key={name}
              className="flex items-center justify-between rounded border border-border bg-white px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-jac-text-secondary" />
                <span className="text-sm font-medium text-jac-dark">{name}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Télécharger
              </Button>
            </div>
          )
        )}
      </div>

      <div className="mt-6 flex justify-center">
        <Button onClick={handleDownload}>
          <Download className="mr-2 h-4 w-4" />
          Télécharger tout (.zip)
        </Button>
      </div>
    </div>
  );
}
