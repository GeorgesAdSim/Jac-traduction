import { NextResponse } from 'next/server';
import { getTerms, searchTerms, addTerm } from '@/lib/glossary-service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceLang = searchParams.get('sourceLang') || undefined;
    const targetLang = searchParams.get('targetLang') || undefined;
    const search = searchParams.get('search') || undefined;

    const terms = search
      ? await searchTerms(search, sourceLang, targetLang)
      : await getTerms(sourceLang, targetLang);

    return NextResponse.json({ terms });
  } catch (err) {
    console.error('[glossary GET] Erreur:', err);
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { source_term, source_lang, translated_term, target_lang, validated, client_id } = body;

    if (!source_term || !source_lang || !translated_term || !target_lang) {
      return NextResponse.json(
        { error: 'Champs obligatoires manquants: source_term, source_lang, translated_term, target_lang' },
        { status: 400 }
      );
    }

    const term = await addTerm({
      source_term,
      source_lang,
      translated_term,
      target_lang,
      validated: validated ?? false,
      client_id: client_id || 'default',
    });

    return NextResponse.json({ term }, { status: 201 });
  } catch (err) {
    console.error('[glossary POST] Erreur:', err);
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
