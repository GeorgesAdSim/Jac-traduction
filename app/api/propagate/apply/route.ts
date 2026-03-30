import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getTerms } from '@/lib/glossary-service';
import type { AppliedModification } from '@/lib/docx-source-cleaner';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface PropagateApplyRequest {
  sourceTexts: string[];
  targetTexts: string[];
  modifications: AppliedModification[];
  sourceLang: string;
  targetLang: string;
  useGlossary: boolean;
}

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Variable d'environnement ANTHROPIC_API_KEY non configurée");
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

const LANG_NAMES: Record<string, string> = {
  EN: 'English',
  FR: 'French',
  DE: 'German',
  NL: 'Dutch',
  RU: 'Russian',
  ES: 'Spanish',
  IT: 'Italian',
  AR: 'Arabic',
  PL: 'Polish',
  PT: 'Portuguese',
};

function buildModificationsSummary(modifications: AppliedModification[]): string {
  return modifications.map((mod, i) => {
    const typeLabel = mod.type === 'DELETE' ? 'DELETE' : mod.type === 'ADD' ? 'ADD' : 'MODIFY';
    let desc = `${i + 1}. [${typeLabel}] "${mod.text}"`;
    if (mod.contextBefore) {
      desc += `\n   Context before: "${mod.contextBefore.substring(0, 100)}"`;
    }
    if (mod.contextAfter) {
      desc += `\n   Context after: "${mod.contextAfter.substring(0, 100)}"`;
    }
    return desc;
  }).join('\n\n');
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
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries reached');
}

/**
 * Process a chunk of target text with Claude to apply modifications.
 */
async function propagateChunk(
  sourceTexts: string[],
  targetTexts: string[],
  modifications: AppliedModification[],
  sourceLang: string,
  targetLang: string,
  glossarySection: string
): Promise<string[]> {
  const sourceSection = sourceTexts
    .map((t, i) => `[P${i}] ${t}`)
    .filter((_t, i) => sourceTexts[i].trim())
    .join('\n');

  const targetSection = targetTexts
    .map((t, i) => `[P${i}] ${t}`)
    .filter((_t, i) => targetTexts[i].trim())
    .join('\n');

  const modSummary = buildModificationsSummary(modifications);

  const systemPrompt = `You are an expert technical documentation translator for JAC industrial bakery machines.
You apply modifications from the ${LANG_NAMES[sourceLang] || sourceLang} source section to the ${LANG_NAMES[targetLang] || targetLang} target section.

MANDATORY RULES:
1. NEVER translate machine names: DURO, VARIA, VMP, VMA, VMS, PICO, FORM-IT, SOLEO, TOPAZE, SIMPLY, NEMO, PICOMATIC
2. NEVER translate error codes: E01, E02, E03, etc.
3. Preserve figure references: fig.2, n°12, §3.1
4. Preserve units: mm, kg, °C, rpm, bar
5. RESPECT the glossary terms exactly when provided
6. Return ONLY the modified target paragraphs in the exact same format [P0], [P1], etc.
7. For paragraphs with NO changes, return them exactly as they were`;

  const userMessage = `Here is the ${LANG_NAMES[sourceLang] || sourceLang} SOURCE section (after modifications were applied):

${sourceSection}

Here are the modifications that were applied to the source:

${modSummary}

Here is the current ${LANG_NAMES[targetLang] || targetLang} TARGET section:

${targetSection}

${glossarySection}

INSTRUCTIONS:
- For each DELETE modification: find the corresponding passage in the target section and remove it
- For each MODIFY modification: find the old text's equivalent in the target and replace it with the translation of the new text
- For each ADD modification: translate the new text and insert it at the same relative position as in the source
- Return ALL paragraphs of the target section (modified and unmodified) in the [P0], [P1], ... format
- Only modify paragraphs that are affected by the listed modifications
- Keep all other paragraphs exactly as they are`;

  const response = await callWithRetry(() =>
    getClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })
  );

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response from Claude');
  }

  // Parse the response: extract [P0], [P1], ... lines
  const lines = content.text.split('\n');
  const resultTexts: string[] = [...targetTexts]; // start with originals

  for (const line of lines) {
    const match = line.match(/^\[P(\d+)\]\s*(.*)/);
    if (match) {
      const idx = parseInt(match[1], 10);
      if (idx >= 0 && idx < resultTexts.length) {
        resultTexts[idx] = match[2];
      }
    }
  }

  return resultTexts;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PropagateApplyRequest;
    const { sourceTexts, targetTexts, modifications, sourceLang, targetLang, useGlossary } = body;

    if (!sourceTexts || !targetTexts || !modifications || !sourceLang || !targetLang) {
      return NextResponse.json(
        { error: 'Missing required fields: sourceTexts, targetTexts, modifications, sourceLang, targetLang' },
        { status: 400 }
      );
    }

    // Get glossary terms if enabled
    let glossarySection = '';
    if (useGlossary) {
      try {
        const terms = await getTerms(sourceLang, targetLang);
        if (terms.length > 0) {
          glossarySection = '\nTECHNICAL GLOSSARY - You MUST use these exact translations:\n' +
            terms.map((t) => `- "${t.source_term}" → "${t.translated_term}"`).join('\n');
        }
      } catch {
        // Glossary unavailable — continue without it
      }
    }

    // Split into chunks if target is very large (>200 paragraphs)
    const CHUNK_SIZE = 200;
    const OVERLAP = 10;
    const resultTexts: string[] = [...targetTexts];

    if (targetTexts.length <= CHUNK_SIZE) {
      const modified = await propagateChunk(
        sourceTexts, targetTexts, modifications,
        sourceLang, targetLang, glossarySection
      );
      for (let i = 0; i < modified.length; i++) {
        resultTexts[i] = modified[i];
      }
    } else {
      // Process in chunks with overlap
      for (let start = 0; start < targetTexts.length; start += CHUNK_SIZE - OVERLAP) {
        const end = Math.min(start + CHUNK_SIZE, targetTexts.length);
        const chunkTarget = targetTexts.slice(start, end);

        // Find modifications relevant to this chunk range
        // (rough mapping based on relative position)
        const chunkMods = modifications.filter((mod) => {
          const relativePos = mod.paragraphIndex / sourceTexts.length;
          const chunkStartRel = start / targetTexts.length;
          const chunkEndRel = end / targetTexts.length;
          return relativePos >= chunkStartRel - 0.1 && relativePos <= chunkEndRel + 0.1;
        });

        if (chunkMods.length === 0) continue;

        const modified = await propagateChunk(
          sourceTexts, chunkTarget, chunkMods,
          sourceLang, targetLang, glossarySection
        );

        // Apply chunk results (skip overlap at beginning except for first chunk)
        const skipStart = start === 0 ? 0 : OVERLAP;
        for (let i = skipStart; i < modified.length; i++) {
          resultTexts[start + i] = modified[i];
        }
      }
    }

    // Count changes
    let changedCount = 0;
    for (let i = 0; i < resultTexts.length; i++) {
      if (resultTexts[i] !== targetTexts[i]) changedCount++;
    }

    return NextResponse.json({
      language: targetLang,
      modifiedTexts: resultTexts,
      stats: {
        totalParagraphs: resultTexts.length,
        modifiedParagraphs: changedCount,
        modificationsApplied: modifications.length,
      },
    });
  } catch (err) {
    console.error('[propagate/apply] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
