import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getTerms } from '@/lib/glossary-service';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ModificationPatch {
  type: 'DELETE' | 'MODIFY' | 'ADD';
  text: string;
  sourceContext: string[];
  targetContext: string[];
  paragraphIndex: number;
}

interface PropagateApplyRequest {
  patches: ModificationPatch[];
  sourceLang: string;
  targetLang: string;
  useGlossary: boolean;
}

interface PatchResult {
  index: number;
  find: string;
  replace: string;
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
 * Process a batch of patches (max 10) with Claude.
 * Returns FIND/REPLACE pairs to apply in the target section.
 */
async function processPatchBatch(
  patches: ModificationPatch[],
  sourceLang: string,
  targetLang: string,
  glossarySection: string
): Promise<PatchResult[]> {
  const targetName = LANG_NAMES[targetLang] || targetLang;
  const sourceName = LANG_NAMES[sourceLang] || sourceLang;

  const patchDescriptions = patches.map((patch, i) => {
    const typeLabel = patch.type;
    const sourceCtx = patch.sourceContext.filter(Boolean).join('\n    ');
    const targetCtx = patch.targetContext.filter(Boolean).join('\n    ');

    return `--- MODIFICATION ${i + 1} [${typeLabel}] ---
  Text in ${sourceName}: "${patch.text}"
  ${sourceName} context (surrounding paragraphs):
    ${sourceCtx}
  ${targetName} context (surrounding paragraphs):
    ${targetCtx}`;
  }).join('\n\n');

  const systemPrompt = `You are an expert technical documentation translator for JAC industrial bakery machines.
You propagate modifications from ${sourceName} to ${targetName}.

MANDATORY RULES:
1. NEVER translate machine names: DURO, VARIA, VMP, VMA, VMS, PICO, FORM-IT, SOLEO, TOPAZE, SIMPLY, NEMO, PICOMATIC
2. NEVER translate error codes: E01, E02, E03, etc.
3. Preserve figure references: fig.2, n°12, §3.1
4. Preserve units: mm, kg, °C, rpm, bar
5. RESPECT the glossary terms exactly when provided

RESPONSE FORMAT — for each modification, output exactly one line:
PATCH N: FIND: <exact text to find in ${targetName}> | REPLACE: <new text in ${targetName}>

For DELETE modifications: the REPLACE value must be empty (nothing after REPLACE:)
For MODIFY modifications: FIND is the old ${targetName} text, REPLACE is the new translated text
For ADD modifications: FIND must be the ${targetName} text of the closest paragraph AFTER which to insert, and REPLACE must be that same text followed by the new translated text

If you cannot find a matching passage in the ${targetName} context, output:
PATCH N: SKIP

Output ONLY PATCH lines, nothing else.`;

  const userMessage = `${patchDescriptions}
${glossarySection}`;

  const response = await callWithRetry(() =>
    getClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })
  );

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response from Claude');
  }

  const results: PatchResult[] = [];
  const lines = content.text.split('\n');

  for (const line of lines) {
    const patchMatch = line.match(/^PATCH\s+(\d+):\s*(?:FIND:\s*(.*?)\s*\|\s*REPLACE:\s*(.*)|SKIP)\s*$/i);
    if (!patchMatch) continue;

    const patchIndex = parseInt(patchMatch[1], 10) - 1;
    if (patchIndex < 0 || patchIndex >= patches.length) continue;

    if (line.toUpperCase().includes('SKIP')) continue;

    const find = (patchMatch[2] || '').trim();
    const replace = (patchMatch[3] || '').trim();

    if (find) {
      results.push({
        index: patches[patchIndex].paragraphIndex,
        find,
        replace,
      });
    }
  }

  return results;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PropagateApplyRequest;
    const { patches, sourceLang, targetLang, useGlossary } = body;

    if (!patches || !sourceLang || !targetLang) {
      return NextResponse.json(
        { error: 'Missing required fields: patches, sourceLang, targetLang' },
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

    // Process patches in batches of 10
    const BATCH_SIZE = 10;
    const allResults: PatchResult[] = [];

    for (let i = 0; i < patches.length; i += BATCH_SIZE) {
      const batch = patches.slice(i, i + BATCH_SIZE);
      const batchResults = await processPatchBatch(batch, sourceLang, targetLang, glossarySection);
      allResults.push(...batchResults);
    }

    return NextResponse.json({
      language: targetLang,
      patches: allResults,
      stats: {
        patchesRequested: patches.length,
        patchesApplied: allResults.length,
      },
    });
  } catch (err) {
    console.error('[propagate/apply] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
