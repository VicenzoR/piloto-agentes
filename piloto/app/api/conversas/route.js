import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { db, empresaDaRequisicao } from "@/lib/db";

export async function GET(req) {
  const { empresa: emp, permitidas, erro, status } = await empresaDaRequisicao(req, new URL(req.url).searchParams.get("empresa_id"));
  if (erro) return NextResponse.json({ erro }, { status });
  const { data: conversas } = await db.from("conversas").select("id, estagio, atendido_por, motivo_escalacao, atualizado_em, clientes(nome, telefone), mensagens(autor, texto, criado_em)")
    .eq("empresa_id", emp.id).order("atualizado_em", { ascending: false }).limit(50);
  const { data: agendamentos } = await db.from("agendamentos").select("servico, data_hora, status, clientes(nome, telefone)").eq("empresa_id", emp.id).order("criado_em", { ascending: false }).limit(20);
  // O painel usa a lista para montar o seletor de empresa.
  return NextResponse.json({
    empresa: emp.nome,
    empresa_id: emp.id,
    empresas: permitidas.map((e) => ({ id: e.id, nome: e.nome })),
    conversas, agendamentos,
  });
}
