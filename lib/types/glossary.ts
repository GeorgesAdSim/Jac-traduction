export interface GlossaryTerm {
  id: string;
  source_term: string;
  source_lang: string;
  translated_term: string;
  target_lang: string;
  validated: boolean;
  client_id: string;
  created_at: string;
  updated_at: string;
}
