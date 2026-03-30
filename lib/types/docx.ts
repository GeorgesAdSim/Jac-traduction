export type ModificationType = "DELETE" | "MODIFY" | "ADD" | "NONE";

export interface Modification {
  id: string;
  type: ModificationType;
  originalText: string;
  paragraphIndex: number;
  context: string;
  color: string;
  language?: string;
}

export interface AnalysisResult {
  filename: string;
  totalParagraphs: number;
  modifications: Modification[];
  languages: string[];
  summary: {
    deletions: number;
    modifications: number;
    additions: number;
  };
  /** Detected language sections in the document */
  sections?: import('@/lib/docx-section-detector').LanguageSection[];
  /** Auto-detected source language code */
  sourceLang?: string;
  /** Raw document XML for later use in propagation */
  documentXml?: string;
}
