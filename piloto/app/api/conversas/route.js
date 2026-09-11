import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { db, empresaPiloto } from "@/lib/db";

export async function GET(req) {
  if (req.headers.get("x-senha") !== process.env.PAINEL_SENHA) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const emp = await empresaPiloto();
  const { data: conversas } = await db.from("conversas").select("id, estagio, atendido_por, motivo_escalacao, atualizado_em, clientes(nome, telefone), mensagens(autor, texto, criado_em)")
    .eq("empresa_id", emp.id).order("atualizado_em", { ascending: false }).limit(50);
  const { data: agendamentos } = await db.from("agendamentos").select("servico, data_hora, status, clientes(nome, telefone)").eq("empresa_id", emp.id).order("criado_em", { ascending: false }).limit(20);
  return NextResponse.json({ empresa: emp.nome, conversas, agendamentos });
}
