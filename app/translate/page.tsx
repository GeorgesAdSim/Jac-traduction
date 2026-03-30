'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Stepper } from '@/components/shared/stepper';
import { DragDropZone } from '@/components/shared/drag-drop-zone';
import { TranslationConfig } from './translation-config';
import { TranslationProgress } from './translation-progress';
import { TranslationResult } from './translation-result';

const STEPS = ['Upload', 'Configuration', 'Traduction', 'Téléchargement'];

export default function TranslatePage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState('FR');
  const [targetLang, setTargetLang] = useState('EN');
  const [useGlossary, setUseGlossary] = useState(true);
  const [progress, setProgress] = useState(0);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFilename, setResultFilename] = useState('');

  const handleFileSelect = useCallback((f: File) => {
    const maxSizeMB = 50;
    if (f.size > maxSizeMB * 1024 * 1024) {
      toast.error(`Le fichier (${(f.size / 1024 / 1024).toFixed(1)} Mo) dépasse la limite de ${maxSizeMB} Mo.`);
      return;
    }
    setFile(f);
    toast.success('Document chargé avec succès');
  }, []);

  const handleUploadContinue = useCallback(() => {
    setCurrentStep(2);
  }, []);

  const handleStartTranslation = useCallback(
    (glossary: boolean) => {
      setUseGlossary(glossary);
      setProgress(0);
      setCurrentStep(3);
      toast.info(`Traduction ${sourceLang} → ${targetLang} en cours...`);
    },
    [sourceLang, targetLang]
  );

  const handleTranslationComplete = useCallback((blob: Blob, filename: string) => {
    setResultBlob(blob);
    setResultFilename(filename);
    setCurrentStep(4);
    toast.success('Traduction terminée');
  }, []);

  const handleTranslationError = useCallback((message: string) => {
    toast.error(message);
    setCurrentStep(2);
  }, []);

  return (
    <div className="bg-white px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-2 text-2xl font-bold text-jac-dark">
          Traduction de document
        </h1>
        <p className="mb-8 text-sm text-jac-text-secondary">
          Traduisez vos documents techniques dans la langue de votre choix
        </p>

        <Stepper steps={STEPS} currentStep={currentStep} />

        <div className="mt-10">
          {currentStep === 1 && (
            <div className="mx-auto max-w-2xl space-y-6">
              <DragDropZone onFileSelect={handleFileSelect} file={file} />
              <Button
                onClick={handleUploadContinue}
                disabled={!file}
                className="w-full"
              >
                Continuer
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {currentStep === 2 && (
            <TranslationConfig
              sourceLang={sourceLang}
              targetLang={targetLang}
              onSourceChange={setSourceLang}
              onTargetChange={setTargetLang}
              onStart={handleStartTranslation}
            />
          )}

          {currentStep === 3 && (
            <TranslationProgress
              sourceLang={sourceLang}
              targetLang={targetLang}
              file={file}
              useGlossary={useGlossary}
              progress={progress}
              onProgress={setProgress}
              onComplete={handleTranslationComplete}
              onError={handleTranslationError}
            />
          )}

          {currentStep === 4 && (
            <TranslationResult
              sourceLang={sourceLang}
              targetLang={targetLang}
              blob={resultBlob}
              filename={resultFilename}
            />
          )}
        </div>
      </div>
    </div>
  );
}
