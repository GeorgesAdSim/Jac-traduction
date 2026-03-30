'use client';

import { useCallback, useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DragDropZoneProps {
  onFileSelect: (file: File) => void;
  file: File | null;
}

export function DragDropZone({ onFileSelect, file }: DragDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        onFileSelect(files[0]);
      }
    },
    [onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        onFileSelect(files[0]);
      }
    },
    [onFileSelect]
  );

  return (
    <div
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={cn(
        'relative flex flex-col items-center justify-center rounded border-2 border-dashed p-12 transition-colors',
        isDragging
          ? 'border-jac-red bg-red-50/50'
          : file
          ? 'border-green-400 bg-green-50/30'
          : 'border-border bg-jac-bg-alt/50 hover:border-jac-text-secondary'
      )}
    >
      {file ? (
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-green-100">
            <FileText className="h-7 w-7 text-green-600" />
          </div>
          <div className="text-center">
            <p className="font-medium text-jac-dark">{file.name}</p>
            <p className="mt-1 text-sm text-jac-text-secondary">
              {(file.size / 1024).toFixed(1)} Ko
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-jac-bg-alt">
            <Upload className="h-7 w-7 text-jac-text-secondary" />
          </div>
          <div className="text-center">
            <p className="font-medium text-jac-dark">
              Glissez votre document Word ici
            </p>
            <p className="mt-1 text-sm text-jac-text-secondary">
              ou cliquez pour parcourir (.docx)
            </p>
          </div>
          <label>
            <Button variant="outline" size="sm" className="mt-2 cursor-pointer" asChild>
              <span>Parcourir</span>
            </Button>
            <input
              type="file"
              accept=".docx,.doc"
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
        </div>
      )}
    </div>
  );
}
