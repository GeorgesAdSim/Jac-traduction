import { NextResponse } from 'next/server';
import { getTerms } from '@/lib/glossary-service';
import { translateBatch } from '@/lib/translation-service';
import type { Modification } from '@/lib/types/docx';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface PropagateLanguageRequest {
  modifications: Modification[];
  targetLang: string;
  useGlossary: boolean;
  sourceLang: string;
}

interface PropagatedModification extends Modification {
  translatedText?: string;
  status: 'translated' | 'deleted' | 'skipped';
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PropagateLanguageRequest;
    const { modifications, targetLang, useGlossary, sourceLang } = body;

    if (!modifications || !targetLang || !sourceLang) {
      return NextResponse.json(
        { error: 'Champs obligatoires: modifications, targetLang, sourceLang' },
        { status: 400 }
      );
    }

    const glossaryTerms = useGlossary
      ? await getTerms(sourceLang, targetLang)
      : [];

    const toTranslate = modifications.filter(
      (m) => m.type === 'MODIFY' || m.type === 'ADD'
    );
    const toDelete = modifications.filter((m) => m.type === 'DELETE');

    const translatedMods: PropagatedModification[] = [];

    for (let i = 0; i < toTranslate.length; i += 20) {
      const batch = toTranslate.slice(i, i + 20);
      const texts = batch.map((m) => m.originalText);

      const translations = await translateBatch({
        texts,
        sourceLang,
        targetLang,
        glossaryTerms,
      });

      for (let j = 0; j < batch.length; j++) {
        translatedMods.push({
          ...batch[j],
          translatedText: translations[j],
          status: 'translated',
        });
      }
    }

    for (const mod of toDelete) {
      translatedMods.push({
        ...mod,
        status: 'deleted',
      });
    }

    return NextResponse.json({
      language: targetLang,
      modifications: translatedMods,
      stats: {
        translated: toTranslate.length,
        deleted: toDelete.length,
        total: modifications.length,
      },
    });
  } catch (err) {
    console.error(`[propagate/language] Erreur:`, err);
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
