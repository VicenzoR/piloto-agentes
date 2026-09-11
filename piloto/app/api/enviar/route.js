import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { db, salvarMensagem } from "@/lib/db";
import { enviarTexto } from "@/lib/whatsapp";

// Humano assume e/ou envia mensagem. { conversa_id, texto?, devolver_para_ia? }
export async function POST(req) {
  if (req.headers.get("x-senha") !== process.env.PAINEL_SENHA) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const { conversa_id, texto, devolver_para_ia } = await req.json();
  const { data: conv } = await db.from("conversas").select("id, clientes(telefone)").eq("id", conversa_id).single();
  if (!conv) return NextResponse.json({ erro: "conversa não encontrada" }, { status: 404 });

  if (devolver_para_ia) {
    await db.from("conversas").update({ atendido_por: "ia", motivo_escalacao: null }).eq("id", conversa_id);
    return NextResponse.json({ ok: true });
  }
  await db.from("conversas").update({ atendido_por: "humano" }).eq("id", conversa_id);
  if (texto) {
    const waId = await enviarTexto(conv.clientes.telefone, texto);
    await salvarMensagem(conversa_id, "humano", texto, waId);
  }
  return NextResponse.json({ ok: true });
}
