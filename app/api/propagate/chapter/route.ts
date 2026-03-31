import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getTerms } from '@/lib/glossary-service';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChapterPropagateRequest {
  sourceChapterBefore: string;
  sourceChapterAfter: string;
  targetChapter: string;
  targetLang: string;
  useGlossary: boolean;
}

const LANG_NAMES: Record<string, string> = {
  EN: 'English', FR: 'French', DE: 'German', NL: 'Dutch',
  RU: 'Russian', ES: 'Spanish', IT: 'Italian', AR: 'Arabic',
  PL: 'Polish', PT: 'Portuguese',
};

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Variable d'environnement ANTHROPIC_API_KEY non configurée");
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (attempt === maxRetries - 1) throw error;
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes('rate_limit') || error.message.includes('overloaded'));
      if (!isRateLimit && attempt > 0) throw error;
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error('Max retries reached');
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChapterPropagateRequest;
    const { sourceChapterBefore, sourceChapterAfter, targetChapter, targetLang, useGlossary } = body;

    if (!sourceChapterBefore || !sourceChapterAfter || !targetChapter || !targetLang) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const targetName = LANG_NAMES[targetLang] || targetLang;

    let glossarySection = '';
    if (useGlossary) {
      try {
        const terms = await getTerms('EN', targetLang);
        if (terms.length > 0) {
          glossarySection =
            '\n\nTECHNICAL GLOSSARY — use these exact translations:\n' +
            terms.map((t) => `- "${t.source_term}" → "${t.translated_term}"`).join('\n');
        }
      } catch {
        // Glossary unavailable — continue without it
      }
    }

    const systemPrompt = `You are a technical translator for JAC industrial bakery machine documentation.
You will receive three versions of the same chapter from a technical manual:
1. SOURCE BEFORE: The English chapter BEFORE modifications
2. SOURCE AFTER: The English chapter AFTER modifications were applied
3. TARGET CURRENT: The ${targetName} chapter that needs the same modifications applied

Each version uses a mixed format:
- Regular paragraphs: [N] paragraph text
- Table rows: [TABLE ROW N] cell1 | cell2 | cell3

Your task: Apply the EXACT same modifications to the ${targetName} chapter.

RESPONSE FORMAT — you MUST use these exact formats:

For regular paragraphs:
- [N] modified text — paragraph whose text changed (translate the new English version)
- [N] original text — paragraph unchanged (copy from TARGET CURRENT as-is)
- [N] <<DELETED>> — paragraph removed (was removed in SOURCE AFTER)
- [N] (empty) — paragraph that should remain empty
- [N+] translated new text — INSERT new paragraph AFTER position N

For table rows:
- [TABLE ROW N] cell1 | cell2 | cell3 — table row (modified or unchanged, with cells separated by |)
- [TABLE ROW N] <<DELETED>> — DELETE entire table row
- [TABLE ROW N+] cell1 | cell2 | cell3 — INSERT new table row AFTER row N

RULES:
1. Text DELETED in English (present in BEFORE, absent in AFTER) → mark <<DELETED>> in ${targetName}
2. Text ADDED in English (absent in BEFORE, present in AFTER) → translate to ${targetName} and INSERT with [N+] or [TABLE ROW N+]
3. Text MODIFIED in English → translate the NEW version to ${targetName}
4. Lines UNCHANGED between BEFORE and AFTER → keep TARGET CURRENT text exactly as-is
5. N must match the original TARGET CURRENT numbering exactly
6. ALL text must be in ${targetName} — NEVER include English text
7. NEVER translate machine names: DURO, VARIA, VMP, VMA, VMS, PICO, FORM-IT, SOLEO, TOPAZE, SIMPLY, NEMO, PICOMATIC
8. NEVER translate error codes: E01, E02, E03, etc.
9. Preserve figure references, units (mm, kg, °C, rpm, bar), and formatting markers
10. Include ALL lines from TARGET CURRENT (as modified, deleted, or unchanged)
11. TABLE ROWS: Keep the same number of cells (separated by |) as the original. When a table row was deleted, use [TABLE ROW N] <<DELETED>>. When a row was added, use [TABLE ROW N+] with translated cells.
12. CRITICAL TRANSLATION: Translate frequency terms precisely. 'weekly' = 'hebdomadaire' in French, NOT 'mensuel'. 'monthly' = 'mensuel'. 'daily' = 'quotidien'. 'weekly' = 'wöchentlich' in German. 'weekly' = 'semanal' in Spanish. Do not confuse frequency terms.${glossarySection}

Return ONLY the modified ${targetName} chapter in the format above. No explanations, no markdown fences.`;

    const userMessage = `SOURCE BEFORE (English, before modifications):
${sourceChapterBefore}

SOURCE AFTER (English, after modifications were applied):
${sourceChapterAfter}

TARGET CURRENT (${targetName}, needs the same modifications):
${targetChapter}

Apply the same modifications. Return ONLY the modified chapter.`;

    const response = await callWithRetry(() =>
      getClient().messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    );

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response from Claude');
    }

    return NextResponse.json({ modifiedChapter: content.text });
  } catch (err) {
    console.error('[propagate/chapter] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
