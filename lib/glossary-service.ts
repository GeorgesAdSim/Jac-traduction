import { createClient } from '@supabase/supabase-js';
import type { GlossaryTerm } from './types/glossary';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

export async function getTerms(
  sourceLang?: string,
  targetLang?: string
): Promise<GlossaryTerm[]> {
  let query = supabase.from('glossary').select('*').order('created_at', { ascending: false });

  if (sourceLang) {
    query = query.eq('source_lang', sourceLang);
  }
  if (targetLang) {
    query = query.eq('target_lang', targetLang);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Erreur glossaire: ${error.message}`);
  return data as GlossaryTerm[];
}

export async function searchTerms(
  searchQuery: string,
  sourceLang?: string,
  targetLang?: string
): Promise<GlossaryTerm[]> {
  let query = supabase
    .from('glossary')
    .select('*')
    .or(`source_term.ilike.%${searchQuery}%,translated_term.ilike.%${searchQuery}%`)
    .order('created_at', { ascending: false });

  if (sourceLang) {
    query = query.eq('source_lang', sourceLang);
  }
  if (targetLang) {
    query = query.eq('target_lang', targetLang);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Erreur recherche glossaire: ${error.message}`);
  return data as GlossaryTerm[];
}

export async function addTerm(
  term: Omit<GlossaryTerm, 'id' | 'created_at' | 'updated_at'>
): Promise<GlossaryTerm> {
  const { data, error } = await supabase
    .from('glossary')
    .insert(term)
    .select()
    .single();

  if (error) throw new Error(`Erreur ajout terme: ${error.message}`);
  return data as GlossaryTerm;
}

export async function updateTerm(
  id: string,
  updates: Partial<Omit<GlossaryTerm, 'id' | 'created_at' | 'updated_at'>>
): Promise<GlossaryTerm> {
  const { data, error } = await supabase
    .from('glossary')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Erreur mise à jour terme: ${error.message}`);
  return data as GlossaryTerm;
}

export async function deleteTerm(id: string): Promise<void> {
  const { error } = await supabase.from('glossary').delete().eq('id', id);
  if (error) throw new Error(`Erreur suppression terme: ${error.message}`);
}

export async function getTermCount(): Promise<number> {
  const { count, error } = await supabase
    .from('glossary')
    .select('*', { count: 'exact', head: true });

  if (error) throw new Error(`Erreur comptage termes: ${error.message}`);
  return count ?? 0;
}
