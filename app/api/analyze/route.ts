import { NextResponse } from "next/server";
import { analyzeDocx } from "@/lib/docx-parser";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

export async function POST(request: Request) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (err) {
      console.error("[analyze] Erreur lecture FormData:", err);
      return NextResponse.json(
        { error: "Impossible de lire le fichier. Vérifiez que la taille ne dépasse pas 50 Mo." },
        { status: 400 }
      );
    }

    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Aucun fichier fourni" },
        { status: 400 }
      );
    }

    if (!file.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json(
        { error: "Format invalide. Seuls les fichiers .docx sont acceptés." },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `Le fichier (${(file.size / 1024 / 1024).toFixed(1)} Mo) dépasse la taille maximale de 50 Mo.` },
        { status: 400 }
      );
    }

    console.log(`[analyze] Début parsing: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} Mo)`);
    const startTime = Date.now();

    const buffer = await file.arrayBuffer();
    const result = await analyzeDocx(buffer, file.name);

    const elapsed = Date.now() - startTime;
    console.log(`[analyze] Parsing terminé en ${elapsed}ms - ${result.modifications.length} modifications`);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[analyze] Erreur:", err);
    const message =
      err instanceof Error ? err.message : "Erreur interne du serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
