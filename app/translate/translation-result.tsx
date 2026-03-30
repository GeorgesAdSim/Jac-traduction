'use client';

import { Download, CircleCheck as CheckCircle2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface TranslationResultProps {
  sourceLang: string;
  targetLang: string;
  blob: Blob | null;
  filename: string;
}

export function TranslationResult({ sourceLang, targetLang, blob, filename }: TranslationResultProps) {
  const handleDownload = () => {
    if (!blob) {
      toast.error('Aucun fichier disponible');
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Téléchargement lancé');
  };

  const sizeKB = blob ? Math.round(blob.size / 1024) : 0;

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

      <div className="flex items-center justify-between rounded border border-border bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-jac-text-secondary" />
          <div>
            <p className="text-sm font-medium text-jac-dark">{filename}</p>
            <p className="text-xs text-jac-text-secondary">{sizeKB} Ko</p>
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
