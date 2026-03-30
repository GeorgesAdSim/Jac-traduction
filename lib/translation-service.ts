import Anthropic from '@anthropic-ai/sdk';
import type { GlossaryTerm } from './types/glossary';

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Variable d\'environnement ANTHROPIC_API_KEY non configurée');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

interface TranslateTextParams {
  text: string;
  sourceLang: string;
  targetLang: string;
  context?: string;
  glossaryTerms?: GlossaryTerm[];
  documentType?: string;
}

interface TranslateBatchParams {
  texts: string[];
  sourceLang: string;
  targetLang: string;
  glossaryTerms?: GlossaryTerm[];
  documentType?: string;
}

function buildSystemPrompt(
  sourceLang: string,
  targetLang: string,
  glossaryTerms?: GlossaryTerm[],
  documentType?: string
): string {
  let prompt = `Tu es un traducteur technique spécialisé dans les machines de boulangerie industrielle (marque JAC).
Tu traduis de ${sourceLang} vers ${targetLang}.

Règles OBLIGATOIRES :
1. Ne traduis PAS les noms de machines : DURO, PICO, FORM-IT, SOLEO, TOPAZE, SIMPLY, NEMO, PICOMATIC, etc.
2. Ne traduis PAS les codes d'erreur : E01, E02, E03, etc.
3. Préserve exactement les références : fig.2, n°12, §3.1, etc.
4. Préserve les unités de mesure : mm, kg, °C, tr/min, bar, etc.
5. Retourne UNIQUEMENT le texte traduit, sans explications ni commentaires.
6. Préserve le formatage : retours à la ligne, puces, numérotation.`;

  if (documentType) {
    prompt += `\n7. Type de document : ${documentType}. Adapte le registre en conséquence.`;
  }

  if (glossaryTerms && glossaryTerms.length > 0) {
    prompt += `\n\nGLOSSAIRE TECHNIQUE - Tu DOIS utiliser ces traductions exactes :\n`;
    for (const term of glossaryTerms) {
      prompt += `- "${term.source_term}" → "${term.translated_term}"\n`;
    }
  }

  return prompt;
}

async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isLastAttempt = attempt === maxRetries - 1;
      if (isLastAttempt) throw error;

      const isRateLimit =
        error instanceof Error &&
        (error.message.includes('rate_limit') || error.message.includes('overloaded'));
      if (!isRateLimit && attempt > 0) throw error;

      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Nombre maximum de tentatives atteint');
}

export async function translateText({
  text,
  sourceLang,
  targetLang,
  context,
  glossaryTerms,
  documentType,
}: TranslateTextParams): Promise<string> {
  if (!text.trim()) return text;

  const systemPrompt = buildSystemPrompt(sourceLang, targetLang, glossaryTerms, documentType);

  let userMessage = text;
  if (context) {
    userMessage = `Contexte du paragraphe : "${context}"\n\nTexte à traduire :\n${text}`;
  }

  const response = await callWithRetry(() =>
    getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })
  );

  const content = response.content[0];
  if (content.type === 'text') {
    return content.text;
  }

  throw new Error('Réponse inattendue de Claude');
}

export async function translateBatch({
  texts,
  sourceLang,
  targetLang,
  glossaryTerms,
  documentType,
}: TranslateBatchParams): Promise<string[]> {
  const batch = texts.slice(0, 20);

  if (batch.length === 0) return [];
  if (batch.length === 1) {
    const result = await translateText({
      text: batch[0],
      sourceLang,
      targetLang,
      glossaryTerms,
      documentType,
    });
    return [result];
  }

  const systemPrompt = buildSystemPrompt(sourceLang, targetLang, glossaryTerms, documentType);

  const numberedTexts = batch
    .map((text, i) => `[${i + 1}] ${text}`)
    .join('\n\n');

  const userMessage = `Traduis chaque texte numéroté ci-dessous. Retourne un tableau JSON contenant les traductions dans le même ordre. Format attendu : ["traduction 1", "traduction 2", ...]

${numberedTexts}`;

  const response = await callWithRetry(() =>
    getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })
  );

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Réponse inattendue de Claude');
  }

  const jsonMatch = content.text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Format de réponse batch invalide');
  }

  const translations = JSON.parse(jsonMatch[0]) as string[];

  if (translations.length !== batch.length) {
    throw new Error(
      `Nombre de traductions (${translations.length}) différent du nombre de textes (${batch.length})`
    );
  }

  return translations;
}
