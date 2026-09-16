import { db } from "@/lib/db";

// Teto de mensagens por mês. O contrato precisa de um limite: a API do WhatsApp
// e o modelo de IA cobram por uso, e plano fixo sem teto vira prejuízo.
// Ajuste por empresa com a variável TETO_MENSAGENS_MES (padrão 1000).
const TIPOS_QUE_CONTAM = ["resposta_ia", "cobranca_enviada", "aviso_enviado", "resumo_enviado"];

export function teto() {
  return Number(process.env.TETO_MENSAGENS_MES || 1000);
}

// Quantas mensagens a empresa já gastou no mês corrente.
export async function consumoDoMes(empresa_id) {
  const inicio = new Date();
  inicio.setUTCDate(1);
  inicio.setUTCHours(0, 0, 0, 0);
  const { data } = await db
    .from("eventos")
    .select("tipo")
    .eq("empresa_id", empresa_id)
    .gte("criado_em", inicio.toISOString());
  return (data || []).filter((e) => TIPOS_QUE_CONTAM.includes(e.tipo)).length;
}

// true quando ainda pode enviar. Registra o estouro uma única vez por mês.
export async function podeEnviar(empresa_id) {
  const usadas = await consumoDoMes(empresa_id);
  const limite = teto();
  if (usadas < limite) return { ok: true, usadas, limite };
  const inicio = new Date();
  inicio.setUTCDate(1);
  inicio.setUTCHours(0, 0, 0, 0);
  const { data: jaAvisou } = await db
    .from("eventos")
    .select("id")
    .eq("empresa_id", empresa_id)
    .eq("tipo", "teto_atingido")
    .gte("criado_em", inicio.toISOString())
    .limit(1);
  return { ok: false, usadas, limite, primeiraVez: !(jaAvisou || []).length };
}
