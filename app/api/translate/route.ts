import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { getTerms } from '@/lib/glossary-service';
import { translateBatch } from '@/lib/translation-service';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_SIZE = 10 * 1024 * 1024;

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
  cdataPropName: '__cdata',
  commentPropName: '__comment',
};

const builderOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  suppressEmptyNode: false,
  format: false,
};

function extractTextsFromXml(nodes: unknown[]): { path: number[]; text: string }[] {
  const results: { path: number[]; text: string }[] = [];

  function walk(nodeList: unknown[], currentPath: number[]) {
    if (!Array.isArray(nodeList)) return;

    for (let i = 0; i < nodeList.length; i++) {
      const node = nodeList[i] as Record<string, unknown>;
      if (!node || typeof node !== 'object') continue;

      // Extract text from w:t nodes
      if ('w:t' in node) {
        const wtContent = node['w:t'] as unknown[];
        if (Array.isArray(wtContent)) {
          for (let j = 0; j < wtContent.length; j++) {
            const textNode = wtContent[j] as Record<string, unknown>;
            if (textNode && '#text' in textNode) {
              const text = String(textNode['#text']);
              if (text.trim()) {
                results.push({ path: [...currentPath, i], text });
              }
            }
          }
        }
      }

      // Recurse into child nodes
      for (const key of Object.keys(node)) {
        if (key.startsWith('@_') || key === '#text' || key === ':@') continue;
        const children = node[key];
        if (Array.isArray(children)) {
          walk(children, [...currentPath, i]);
        }
      }
    }
  }

  walk(nodes, []);
  return results;
}

function replaceTextsInXml(
  nodes: unknown[],
  translations: Map<string, string>
): void {
  if (!Array.isArray(nodes)) return;

  for (const node of nodes) {
    const n = node as Record<string, unknown>;
    if (!n || typeof n !== 'object') continue;

    if ('w:t' in n) {
      const wtContent = n['w:t'] as unknown[];
      if (Array.isArray(wtContent)) {
        for (const textNode of wtContent) {
          const tn = textNode as Record<string, unknown>;
          if (tn && '#text' in tn) {
            const original = String(tn['#text']);
            const translated = translations.get(original);
            if (translated) {
              tn['#text'] = translated;
            }
          }
        }
      }
    }

    for (const key of Object.keys(n)) {
      if (key.startsWith('@_') || key === '#text' || key === ':@') continue;
      const children = n[key];
      if (Array.isArray(children)) {
        replaceTextsInXml(children, translations);
      }
    }
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const sourceLang = (formData.get('sourceLang') as string) || 'FR';
    const targetLang = (formData.get('targetLang') as string) || 'EN';
    const useGlossary = formData.get('useGlossary') !== 'false';

    if (!file) {
      return NextResponse.json({ error: 'Aucun fichier fourni' }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith('.docx')) {
      return NextResponse.json(
        { error: 'Format invalide. Seuls les fichiers .docx sont acceptés.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'Le fichier dépasse la taille maximale de 10 Mo.' },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    const docFile = zip.file('word/document.xml');
    if (!docFile) {
      return NextResponse.json(
        { error: 'Fichier document.xml introuvable dans le .docx' },
        { status: 400 }
      );
    }

    const xmlContent = await docFile.async('string');
    const parser = new XMLParser(parserOptions);
    const parsed = parser.parse(xmlContent);

    // Extract all texts
    const textEntries = extractTextsFromXml(parsed);
    const uniqueTexts = Array.from(new Set(textEntries.map((e) => e.text))).filter(
      (t) => t.trim().length > 0
    );

    // Load glossary
    const glossaryTerms = useGlossary ? await getTerms(sourceLang, targetLang) : [];

    // Translate in batches of 20
    const translationMap = new Map<string, string>();

    for (let i = 0; i < uniqueTexts.length; i += 20) {
      const batch = uniqueTexts.slice(i, i + 20);
      const translations = await translateBatch({
        texts: batch,
        sourceLang,
        targetLang,
        glossaryTerms,
      });

      for (let j = 0; j < batch.length; j++) {
        translationMap.set(batch[j], translations[j]);
      }
    }

    // Replace texts in parsed XML
    replaceTextsInXml(parsed, translationMap);

    // Rebuild XML
    const builder = new XMLBuilder(builderOptions);
    const newXml = builder.build(parsed);

    // Replace in zip
    zip.file('word/document.xml', newXml);

    // Generate output
    const outputBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    const outputFilename = file.name.replace('.docx', `_${targetLang}.docx`);

    return new NextResponse(outputBuffer, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${outputFilename}"`,
      },
    });
  } catch (err) {
    console.error('[translate] Erreur:', err);
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
