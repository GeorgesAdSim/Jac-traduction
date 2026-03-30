import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { classifyColor } from "./color-classifier";
import type { AnalysisResult, Modification, ModificationType } from "./types/docx";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: false,
});

function extractText(wt: unknown): string {
  if (typeof wt === "string") return wt;
  if (wt && typeof wt === "object" && "#text" in (wt as Record<string, unknown>)) {
    return String((wt as Record<string, unknown>)["#text"]);
  }
  if (Array.isArray(wt)) {
    return wt.map(extractText).join("");
  }
  return "";
}

function getRunColor(run: Record<string, unknown>): string | null {
  const rPr = run["w:rPr"] as Record<string, unknown> | undefined;
  if (!rPr) return null;

  const wColor = rPr["w:color"] as Record<string, unknown> | undefined;
  if (wColor) {
    const val = wColor["@_w:val"] as string | undefined;
    if (val && val !== "auto" && val !== "000000") return val;
  }

  const highlight = rPr["w:highlight"] as Record<string, unknown> | undefined;
  if (highlight) {
    const val = highlight["@_w:val"] as string | undefined;
    if (val && val !== "none") return val;
  }

  const shd = rPr["w:shd"] as Record<string, unknown> | undefined;
  if (shd) {
    const fill = shd["@_w:fill"] as string | undefined;
    if (fill && fill !== "auto" && fill !== "FFFFFF" && fill !== "ffffff") return fill;
  }

  return null;
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function extractLanguages(docXml: Record<string, unknown>): string[] {
  const langs = new Set<string>();

  function walk(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    const record = obj as Record<string, unknown>;

    if (record["w:lang"]) {
      const lang = record["w:lang"] as Record<string, unknown>;
      for (const key of ["@_w:val", "@_w:bidi", "@_w:eastAsia"]) {
        const val = lang[key] as string | undefined;
        if (val) langs.add(val.split("-")[0].toLowerCase());
      }
    }

    for (const val of Object.values(record)) {
      if (Array.isArray(val)) {
        val.forEach(walk);
      } else if (val && typeof val === "object") {
        walk(val);
      }
    }
  }

  walk(docXml);
  return Array.from(langs);
}

export async function analyzeDocxClient(buffer: ArrayBuffer, filename: string): Promise<AnalysisResult> {
  const zip = await JSZip.loadAsync(buffer, { createFolders: false });

  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error("Fichier document.xml introuvable dans le .docx");
  }

  const xmlContent = await docFile.async("string");
  const parsed = parser.parse(xmlContent);

  const document = parsed["w:document"] as Record<string, unknown> | undefined;
  if (!document) throw new Error("Structure XML invalide : w:document manquant");

  const body = document["w:body"] as Record<string, unknown> | undefined;
  if (!body) throw new Error("Structure XML invalide : w:body manquant");

  const paragraphs = ensureArray(body["w:p"] as Record<string, unknown> | Record<string, unknown>[]);

  const modifications: Modification[] = [];
  let modCounter = 0;

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx];
    const runs = ensureArray(para["w:r"] as Record<string, unknown> | Record<string, unknown>[]);

    const contextParts: string[] = [];
    for (const run of runs) {
      const text = extractText(run["w:t"]);
      if (text) contextParts.push(text);
    }
    const fullContext = contextParts.join("");

    let currentType: ModificationType = "NONE";
    let currentText = "";
    let currentColor = "";

    for (const run of runs) {
      const colorVal = getRunColor(run);
      const modType: ModificationType = colorVal ? classifyColor(colorVal) : "NONE";
      const text = extractText(run["w:t"]);

      if (modType === currentType && modType !== "NONE") {
        currentText += text;
      } else {
        if (currentType !== "NONE" && currentText.trim()) {
          modCounter++;
          modifications.push({
            id: `mod-${String(modCounter).padStart(3, "0")}`,
            type: currentType,
            originalText: currentText,
            paragraphIndex: pIdx,
            context: fullContext,
            color: currentColor,
          });
        }
        currentType = modType;
        currentText = modType !== "NONE" ? text : "";
        currentColor = colorVal || "";
      }
    }

    if (currentType !== "NONE" && currentText.trim()) {
      modCounter++;
      modifications.push({
        id: `mod-${String(modCounter).padStart(3, "0")}`,
        type: currentType,
        originalText: currentText,
        paragraphIndex: pIdx,
        context: fullContext,
        color: currentColor,
      });
    }
  }

  const languages = extractLanguages(parsed);

  return {
    filename,
    totalParagraphs: paragraphs.length,
    modifications,
    languages: languages.length > 0 ? languages : ["fr"],
    summary: {
      deletions: modifications.filter((m) => m.type === "DELETE").length,
      modifications: modifications.filter((m) => m.type === "MODIFY").length,
      additions: modifications.filter((m) => m.type === "ADD").length,
    },
  };
}
