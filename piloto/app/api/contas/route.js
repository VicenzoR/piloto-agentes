import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { db, empresaPiloto } from "@/lib/db";

function auth(req) { return req.headers.get("x-senha") === process.env.PAINEL_SENHA; }

// Lista as contas a receber, com resumo (serve de linha de base do piloto)
export async function GET(req) {
  if (!auth(req)) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const emp = await empresaPiloto();
  const { data } = await db.from("contas_receber").select("*").eq("empresa_id", emp.id).order("vencimento", { ascending: true });
  const hoje = new Date().toISOString().slice(0, 10);
  const contas = (data || []).map((c) => ({
    ...c,
    dias_atraso: c.status === "aberto" && c.vencimento < hoje
      ? Math.floor((new Date(hoje) - new Date(c.vencimento)) / 86400000) : 0,
  }));
  const abertas = contas.filter((c) => c.status === "aberto");
  const vencidas = abertas.filter((c) => c.dias_atraso > 0);
  return NextResponse.json({
    contas,
    resumo: {
      total_aberto: abertas.reduce((s, c) => s + Number(c.valor), 0),
      total_vencido: vencidas.reduce((s, c) => s + Number(c.valor), 0),
      qtd_vencida: vencidas.length,
      media_atraso: vencidas.length ? Math.round(vencidas.reduce((s, c) => s + c.dias_atraso, 0) / vencidas.length) : 0,
    },
  });
}

// Cadastra uma conta ou várias de uma vez (colando de planilha)
export async function POST(req) {
  if (!auth(req)) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const emp = await empresaPiloto();
  const body = await req.json();
  const linhas = body.linhas || [body];

  const limpos = [];
  const erros = [];
  for (const [i, l] of linhas.entries()) {
    const nome = String(l.cliente_nome || "").trim();
    const tel = String(l.telefone || "").replace(/\D/g, "");
    const bruto = String(l.valor ?? "").trim();
    const valor = Number(
      bruto.includes(",")
        ? bruto.replace(/\./g, "").replace(",", ".")
        : bruto.replace(/[^\d.]/g, "")
    );
    const venc = String(l.vencimento || "").trim();

    if (!nome) { erros.push(`linha ${i + 1}: nome vazio`); continue; }
    if (tel.length < 12 || !tel.startsWith("55")) { erros.push(`linha ${i + 1}: telefone precisa do DDI, ex 5527999999999`); continue; }
    if (!valor || valor <= 0) { erros.push(`linha ${i + 1}: valor inválido`); continue; }
    const data = venc.includes("/") ? venc.split("/").reverse().join("-") : venc;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { erros.push(`linha ${i + 1}: data deve ser DD/MM/AAAA`); continue; }

    limpos.push({ empresa_id: emp.id, cliente_nome: nome, telefone: tel, valor, vencimento: data });
  }

  if (limpos.length) {
    const { error } = await db
      .from("contas_receber")
      .upsert(limpos, { onConflict: "empresa_id,telefone,valor,vencimento", ignoreDuplicates: true });
    if (error) return NextResponse.json({ erro: error.message }, { status: 400 });
  }
  return NextResponse.json({ inseridas: limpos.length, erros });
}

// Marca como paga, reabre ou apaga
export async function PATCH(req) {
  if (!auth(req)) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const { id, acao } = await req.json();
  if (acao === "apagar") await db.from("contas_receber").delete().eq("id", id);
  else await db.from("contas_receber").update({ status: acao === "pago" ? "pago" : "aberto" }).eq("id", id);
  return NextResponse.json({ ok: true });
}
