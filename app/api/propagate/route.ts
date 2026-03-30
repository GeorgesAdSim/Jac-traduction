import { NextResponse } from 'next/server';
import { getTerms } from '@/lib/glossary-service';
import { translateBatch } from '@/lib/translation-service';
import type { Modification } from '@/lib/types/docx';

interface PropagateRequest {
  modifications: Modification[];
  targetLanguages: string[];
  useGlossary: boolean;
  sourceLang: string;
}

interface PropagatedModification extends Modification {
  translatedText?: string;
  status: 'translated' | 'deleted' | 'skipped';
}

interface LanguageResult {
  language: string;
  modifications: PropagatedModification[];
  stats: { translated: number; deleted: number; total: number };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PropagateRequest;
    const { modifications, targetLanguages, useGlossary, sourceLang } = body;

    if (!modifications || !targetLanguages || !sourceLang) {
      return NextResponse.json(
        { error: 'Champs obligatoires: modifications, targetLanguages, sourceLang' },
        { status: 400 }
      );
    }

    const results: LanguageResult[] = [];

    for (let langIdx = 0; langIdx < targetLanguages.length; langIdx++) {
      const targetLang = targetLanguages[langIdx];

      const glossaryTerms = useGlossary
        ? await getTerms(sourceLang, targetLang)
        : [];

      const toTranslate = modifications.filter(
        (m) => m.type === 'MODIFY' || m.type === 'ADD'
      );
      const toDelete = modifications.filter((m) => m.type === 'DELETE');

      const translatedMods: PropagatedModification[] = [];

      // Translate in batches of 20
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

      // Mark deletions
      for (const mod of toDelete) {
        translatedMods.push({
          ...mod,
          status: 'deleted',
        });
      }

      results.push({
        language: targetLang,
        modifications: translatedMods,
        stats: {
          translated: toTranslate.length,
          deleted: toDelete.length,
          total: modifications.length,
        },
      });
    }

    const headers = new Headers();
    headers.set('X-Progress', '100');

    return NextResponse.json({ results }, { headers });
  } catch (err) {
    console.error('[propagate] Erreur:', err);
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
