import { NextResponse } from "next/server";
import { analyzeDocx } from "@/lib/docx-parser";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
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
        { error: "Le fichier dépasse la taille maximale de 10 Mo." },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();
    const result = await analyzeDocx(buffer, file.name);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[analyze] Erreur:", err);
    const message =
      err instanceof Error ? err.message : "Erreur interne du serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
