import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { db, empresaPiloto, registrarEvento } from "@/lib/db";
import { enviarTemplate } from "@/lib/whatsapp";
import { podeEnviar } from "@/lib/limites";
import empresa from "@/config/empresa.json";

// POST /api/cobranca
//   { "modo": "atraso", "dias_min": 3 }  → cobra quem já venceu (padrão)
//   { "modo": "aviso",  "dias_antes": 3 } → avisa quem vence nos próximos dias
// Sempre com template aprovado, em horário comercial, sem repetir o mesmo cliente.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const senha = body.senha || req.headers.get("x-senha");
  const modo = body.modo === "aviso" ? "aviso" : "atraso";
  const dias_min = body.dias_min ?? 3;
  const dias_antes = body.dias_antes ?? 3;
  if (senha !== process.env.PAINEL_SENHA) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });

  const hora = new Date().getUTCHours() - 3; // Brasília
  if (hora < 8 || hora >= 20) return NextResponse.json({ erro: "fora do horário comercial (8h-20h)" }, { status: 400 });

  const emp = await empresaPiloto();
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const semana = new Date(Date.now() - 7 * 86400000).toISOString();

  let contas;
  if (modo === "aviso") {
    // Vence de hoje até daqui a dias_antes, e ainda não foi avisado nesta semana.
    const teto_data = new Date(new Date(hoje).getTime() + dias_antes * 86400000).toISOString().slice(0, 10);
    ({ data: contas } = await db.from("contas_receber").select("*").eq("empresa_id", emp.id).eq("status", "aberto")
      .gte("vencimento", hoje).lte("vencimento", teto_data)
      .or(`ultimo_aviso.is.null,ultimo_aviso.lt.${semana}`));
  } else {
    const limite = new Date(Date.now() - dias_min * 86400000).toISOString().slice(0, 10);
    ({ data: contas } = await db.from("contas_receber").select("*").eq("empresa_id", emp.id).eq("status", "aberto").lte("vencimento", limite)
      .or(`ultima_cobranca.is.null,ultima_cobranca.lt.${semana}`));
  }

  const enviadas = [];
  for (const c of contas || []) {
    // Teto de mensagens do mês: para antes de estourar a margem do contrato.
    const lim = await podeEnviar(emp.id);
    if (!lim.ok) {
      await registrarEvento(emp.id, "teto_atingido", { usadas: lim.usadas, limite: lim.limite });
      return NextResponse.json({ enviadas: enviadas.length, clientes: enviadas, erro: `teto de mensagens do mês atingido (${lim.usadas}/${lim.limite})` });
    }
    try {
      const venc = c.vencimento.split("-").reverse().join("/");
      const valor = Number(c.valor).toFixed(2).replace(".", ",");
      if (modo === "aviso") {
        await enviarTemplate(c.telefone, "aviso_vencimento", [c.cliente_nome, empresa.nome, valor, venc]);
        await db.from("contas_receber").update({ ultimo_aviso: new Date().toISOString() }).eq("id", c.id);
        await registrarEvento(emp.id, "aviso_enviado", { cliente: c.cliente_nome, valor: c.valor });
      } else {
        await enviarTemplate(c.telefone, "lembrete_vencimento", [c.cliente_nome, empresa.nome, valor, venc]);
        await db.from("contas_receber").update({ ultima_cobranca: new Date().toISOString() }).eq("id", c.id);
        await registrarEvento(emp.id, "cobranca_enviada", { cliente: c.cliente_nome, valor: c.valor });
      }
      enviadas.push(c.cliente_nome);
    } catch (e) {
      await registrarEvento(emp.id, "erro", { cobranca: c.id, erro: String(e) });
    }
  }
  return NextResponse.json({ enviadas: enviadas.length, clientes: enviadas, modo });
}
