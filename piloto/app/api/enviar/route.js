import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { db, salvarMensagem, empresaDaRequisicao } from "@/lib/db";
import { enviarTexto } from "@/lib/whatsapp";

// Humano assume e/ou envia mensagem. { conversa_id, texto?, devolver_para_ia? }
export async function POST(req) {
  const { conversa_id, texto, devolver_para_ia, empresa_id } = await req.json();
  const { empresa, erro, status } = await empresaDaRequisicao(req, empresa_id);
  if (erro) return NextResponse.json({ erro }, { status });
  // A conversa tem que ser da empresa da senha usada.
  const { data: conv } = await db.from("conversas").select("id, clientes(telefone)").eq("id", conversa_id).eq("empresa_id", empresa.id).maybeSingle();
  if (!conv) return NextResponse.json({ erro: "conversa não encontrada" }, { status: 404 });

  if (devolver_para_ia) {
    await db.from("conversas").update({ atendido_por: "ia", motivo_escalacao: null }).eq("id", conversa_id);
    return NextResponse.json({ ok: true });
  }
  await db.from("conversas").update({ atendido_por: "humano" }).eq("id", conversa_id);
  if (texto) {
    const waId = await enviarTexto(empresa, conv.clientes.telefone, texto);
    await salvarMensagem(conversa_id, "humano", texto, waId);
  }
  return NextResponse.json({ ok: true });
}
