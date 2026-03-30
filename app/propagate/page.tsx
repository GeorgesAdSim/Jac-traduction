'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Play, CircleCheck as CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Stepper } from '@/components/shared/stepper';
import { DragDropZone } from '@/components/shared/drag-drop-zone';
import { AnalysisTable } from './analysis-table';
import { ValidationStep } from './validation-step';
import { PropagationStep } from './propagation-step';
import { DownloadStep } from './download-step';

const STEPS = ['Upload', 'Analyse', 'Validation', 'Propagation', 'Téléchargement'];

export default function PropagatePage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);

  const handleFileSelect = useCallback((f: File) => {
    setFile(f);
    toast.success('Document chargé avec succès');
  }, []);

  const handleAnalyze = useCallback(() => {
    toast.info('Analyse du document en cours...');
    setTimeout(() => {
      setCurrentStep(2);
      toast.success('Analyse terminée - 6 modifications détectées');
    }, 1200);
  }, []);

  const handleValidate = useCallback(() => {
    setCurrentStep(3);
  }, []);

  const handleStartPropagation = useCallback(() => {
    setCurrentStep(4);
  }, []);

  const handlePropagationComplete = useCallback(() => {
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
                disabled={!file}
                className="w-full"
              >
                <Play className="mr-2 h-4 w-4" />
                Analyser le document
              </Button>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <AnalysisTable />
              <div className="flex justify-end">
                <Button onClick={handleValidate}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Valider et continuer
                </Button>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <ValidationStep onContinue={handleStartPropagation} />
          )}

          {currentStep === 4 && (
            <PropagationStep onComplete={handlePropagationComplete} />
          )}

          {currentStep === 5 && <DownloadStep />}
        </div>
      </div>
    </div>
  );
}
