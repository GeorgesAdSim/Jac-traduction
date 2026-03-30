'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Play, CircleCheck as CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Stepper } from '@/components/shared/stepper';
import { DragDropZone } from '@/components/shared/drag-drop-zone';
import { AnalysisTable } from './analysis-table';
import { ValidationStep } from './validation-step';
import { PropagationStep } from './propagation-step';
import { DownloadStep } from './download-step';
import type { AnalysisResult, Modification } from '@/lib/types/docx';

const STEPS = ['Upload', 'Analyse', 'Validation', 'Propagation', 'Téléchargement'];

export default function PropagatePage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedModifications, setSelectedModifications] = useState<Modification[]>([]);
  const [propagationResults, setPropagationResults] = useState<unknown>(null);

  const handleFileSelect = useCallback((f: File) => {
    const maxSizeMB = 50;
    if (f.size > maxSizeMB * 1024 * 1024) {
      toast.error(`Le fichier (${(f.size / 1024 / 1024).toFixed(1)} Mo) dépasse la limite de ${maxSizeMB} Mo.`);
      return;
    }
    setFile(f);
    toast.success('Document chargé avec succès');
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!file) return;

    setIsAnalyzing(true);
    toast.info('Lecture du document...');

    try {
      const { analyzeDocxClient } = await import('@/lib/client-docx-parser');
      const buffer = await file.arrayBuffer();
      const analysisData = await analyzeDocxClient(buffer, file.name);

      setAnalysisResult(analysisData);
      setCurrentStep(2);

      const total = analysisData.modifications?.length ?? 0;
      toast.success(`Analyse terminée - ${total} modification${total > 1 ? 's' : ''} détectée${total > 1 ? 's' : ''}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      toast.error(message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [file]);

  const handleValidate = useCallback(() => {
    setCurrentStep(3);
  }, []);

  const handleValidationContinue = useCallback(
    (selectedIds: string[]) => {
      if (!analysisResult) return;
      const selected = analysisResult.modifications.filter((m) =>
        selectedIds.includes(m.id)
      );
      setSelectedModifications(selected);
      setCurrentStep(4);
    },
    [analysisResult]
  );

  const handlePropagationComplete = useCallback((results: unknown) => {
    setPropagationResults(results);
    setCurrentStep(5);
  }, []);

  return (
    <div className="bg-white px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-2 text-2xl font-bold text-jac-dark">
          Propagation des modifications
        </h1>
        <p className="mb-8 text-sm text-jac-text-secondary">
          Propagez les changements annotés dans toutes les langues cibles
        </p>

        <Stepper steps={STEPS} currentStep={currentStep} />

        <div className="mt-10">
          {currentStep === 1 && (
            <div className="mx-auto max-w-2xl space-y-6">
              <DragDropZone onFileSelect={handleFileSelect} file={file} />
              <div className="rounded bg-jac-bg-alt p-4">
                <p className="text-xs font-medium text-jac-text-secondary">
                  Le document doit contenir des annotations couleur :
                </p>
                <div className="mt-2 flex flex-wrap gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
                    Rouge = supprimer
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-full bg-blue-500" />
                    Bleu = modifier
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
                    Vert = ajouter
                  </span>
                </div>
              </div>
              <Button
                onClick={handleAnalyze}
                disabled={!file || isAnalyzing}
                className="w-full"
              >
                {isAnalyzing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {isAnalyzing ? 'Analyse en cours...' : 'Analyser le document'}
              </Button>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <AnalysisTable result={analysisResult} />
              <div className="flex justify-end">
                <Button onClick={handleValidate}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Valider et continuer
                </Button>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <ValidationStep
              modifications={analysisResult?.modifications}
              onContinue={handleValidationContinue}
            />
          )}

          {currentStep === 4 && (
            <PropagationStep
              modifications={selectedModifications}
              sourceLang={analysisResult?.languages[0] || 'FR'}
              onComplete={handlePropagationComplete}
            />
          )}

          {currentStep === 5 && (
            <DownloadStep
              results={propagationResults as DownloadStepProps_Results}
              filename={file?.name}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type DownloadStepProps_Results = {
  language: string;
  modifications: unknown[];
  stats: { translated: number; deleted: number; total: number };
}[];
