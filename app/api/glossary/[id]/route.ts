import { NextResponse } from 'next/server';
import { updateTerm, deleteTerm } from '@/lib/glossary-service';

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const term = await updateTerm(params.id, body);
    return NextResponse.json({ term });
  } catch (err) {
    console.error('[glossary PUT] Erreur:', err);
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await deleteTerm(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[glossary DELETE] Erreur:', err);
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
