import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getTerms } from '@/lib/glossary-service';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface TranslateBatchRequest {
  texts: string[];
  targetLang: string;
  useGlossary: boolean;
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TranslateBatchRequest;
    const { texts, targetLang, useGlossary } = body;

    if (!texts || !targetLang) {
      return NextResponse.json(
        { error: 'Missing required fields: texts, targetLang' },
        { status: 400 }
      );
    }

    if (texts.length === 0) {
      return NextResponse.json({ translations: [] });
    }

    const targetName = LANG_NAMES[targetLang] || targetLang;

    // Build glossary section if enabled
    let glossarySection = '';
    if (useGlossary) {
      try {
        const terms = await getTerms('EN', targetLang);
        if (terms.length > 0) {
          glossarySection = '\n\nTECHNICAL GLOSSARY — use these exact translations:\n' +
            terms.map((t) => `- "${t.source_term}" → "${t.translated_term}"`).join('\n');
        }
      } catch {
        // Glossary unavailable — continue without it
      }
    }

    // Build numbered text list
    const numberedTexts = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');

    const systemPrompt = `You are a technical translator for JAC industrial bakery machine documentation.
Translate each numbered text to ${targetName}. Return ONLY the translations, one per line, numbered identically.

MANDATORY RULES:
1. NEVER translate machine names: DURO, VARIA, VMP, VMA, VMS, PICO, FORM-IT, SOLEO, TOPAZE, SIMPLY, NEMO, PICOMATIC
2. NEVER translate error codes: E01, E02, E03, etc.
3. Preserve figure references: fig.2, n°12, §3.1
4. Preserve units: mm, kg, °C, rpm, bar
5. ALL output MUST be in ${targetName}
6. RESPECT the glossary terms exactly when provided${glossarySection}`;

    const response = await callWithRetry(() =>
      getClient().messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: numberedTexts }],
      })
    );

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response from Claude');
    }

    // Parse numbered translations
    const lines = content.text.split('\n').filter((l) => l.trim());
    const translations: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      // Try to find line starting with "N." or "N)"
      const prefix = `${i + 1}.`;
      const prefixAlt = `${i + 1})`;
      let found = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith(prefix)) {
          translations.push(trimmed.substring(prefix.length).trim());
          found = true;
          break;
        }
        if (trimmed.startsWith(prefixAlt)) {
          translations.push(trimmed.substring(prefixAlt.length).trim());
          found = true;
          break;
        }
      }
      if (!found) {
        // Fallback: use line by index if available
        if (i < lines.length) {
          const line = lines[i].trim();
          // Strip any leading number prefix
          const stripped = line.replace(/^\d+[\.\)]\s*/, '');
          translations.push(stripped || texts[i]);
        } else {
          translations.push(texts[i]); // keep original if translation missing
        }
      }
    }

    return NextResponse.json({ translations });
  } catch (err) {
    console.error('[propagate/apply] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
