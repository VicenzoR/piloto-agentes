import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { db, empresaPiloto, registrarEvento } from "@/lib/db";
import { enviarTemplate } from "@/lib/whatsapp";
import empresa from "@/config/empresa.json";

// POST /api/cobranca  { "senha": "...", "dias_min": 3 }
// Envia lembrete (template aprovado) para contas vencidas há pelo menos dias_min dias,
// no máximo uma vez a cada 7 dias por conta, só em horário comercial.
export async function POST(req) {
  const { senha, dias_min = 3 } = await req.json();
  if (senha !== process.env.PAINEL_SENHA) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });

  const hora = new Date().getUTCHours() - 3; // Brasília
  if (hora < 8 || hora >= 20) return NextResponse.json({ erro: "fora do horário comercial (8h-20h)" }, { status: 400 });

  const emp = await empresaPiloto();
  const limite = new Date(Date.now() - dias_min * 86400000).toISOString().slice(0, 10);
  const semana = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: contas } = await db.from("contas_receber").select("*").eq("empresa_id", emp.id).eq("status", "aberto").lte("vencimento", limite)
    .or(`ultima_cobranca.is.null,ultima_cobranca.lt.${semana}`);

  const enviadas = [];
  for (const c of contas || []) {
    try {
      const venc = c.vencimento.split("-").reverse().join("/");
      await enviarTemplate(c.telefone, "lembrete_vencimento", [c.cliente_nome, empresa.nome, Number(c.valor).toFixed(2).replace(".", ","), venc]);
      await db.from("contas_receber").update({ ultima_cobranca: new Date().toISOString() }).eq("id", c.id);
      await registrarEvento(emp.id, "cobranca_enviada", { cliente: c.cliente_nome, valor: c.valor });
      enviadas.push(c.cliente_nome);
    } catch (e) {
      await registrarEvento(emp.id, "erro", { cobranca: c.id, erro: String(e) });
    }
  }
  return NextResponse.json({ enviadas: enviadas.length, clientes: enviadas });
}
