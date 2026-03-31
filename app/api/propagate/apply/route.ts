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
  action: 'delete' | 'modify' | 'insert_after';
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

RESPONSE FORMAT — for each modification, output exactly one line using the format that matches the modification type:

For DELETE: find the equivalent text in ${targetName} and output:
PATCH N: DELETE: <exact text to find and remove in ${targetName}>

For MODIFY: find the old text in ${targetName} and output the replacement:
PATCH N: FIND: <old text in ${targetName}> | REPLACE: <new translated text>

For ADD: find the nearest paragraph in ${targetName} BEFORE the insertion point and output:
PATCH N: INSERT_AFTER: <anchor text from ${targetName} paragraph> | NEW: <translated text to add>

If you cannot find a matching passage, output:
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
    // Match PATCH N: ...
    const patchNumMatch = line.match(/^PATCH\s+(\d+):\s*(.*)/i);
    if (!patchNumMatch) continue;

    const patchIndex = parseInt(patchNumMatch[1], 10) - 1;
    if (patchIndex < 0 || patchIndex >= patches.length) continue;

    const rest = patchNumMatch[2].trim();
    if (rest.toUpperCase() === 'SKIP') continue;

    // DELETE: <text>
    const deleteMatch = rest.match(/^DELETE:\s*(.+)/i);
    if (deleteMatch) {
      const find = deleteMatch[1].trim();
      if (find) {
        results.push({ index: patches[patchIndex].paragraphIndex, action: 'delete', find, replace: '' });
      }
      continue;
    }

    // INSERT_AFTER: <anchor> | NEW: <text>
    const insertMatch = rest.match(/^INSERT_AFTER:\s*(.*?)\s*\|\s*NEW:\s*(.*)/i);
    if (insertMatch) {
      const find = (insertMatch[1] || '').trim();
      const replace = (insertMatch[2] || '').trim();
      if (find && replace) {
        results.push({ index: patches[patchIndex].paragraphIndex, action: 'insert_after', find, replace });
      }
      continue;
    }

    // FIND: <old> | REPLACE: <new>
    const modifyMatch = rest.match(/^FIND:\s*(.*?)\s*\|\s*REPLACE:\s*(.*)/i);
    if (modifyMatch) {
      const find = (modifyMatch[1] || '').trim();
      const replace = (modifyMatch[2] || '').trim();
      if (find) {
        results.push({ index: patches[patchIndex].paragraphIndex, action: 'modify', find, replace });
      }
      continue;
    }
  }

  return results;
}

const MAX_PATCHES_PER_CALL = 10;

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

    if (patches.length > MAX_PATCHES_PER_CALL) {
      return NextResponse.json(
        { error: `Max ${MAX_PATCHES_PER_CALL} patches per call. Received ${patches.length}. Batch on the client side.` },
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

    // Single Claude call with the received patches (max 10)
    const results = await processPatchBatch(patches, sourceLang, targetLang, glossarySection);

    return NextResponse.json({
      language: targetLang,
      patches: results,
      stats: {
        patchesRequested: patches.length,
        patchesApplied: results.length,
      },
    });
  } catch (err) {
    console.error('[propagate/apply] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
