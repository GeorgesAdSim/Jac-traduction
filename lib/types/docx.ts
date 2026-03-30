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
}
