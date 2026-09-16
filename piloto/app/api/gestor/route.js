import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { db, empresaPiloto, registrarEvento } from "@/lib/db";
import { enviarTexto } from "@/lib/whatsapp";
import { consumoDoMes, teto } from "@/lib/limites";

const DIA = 86400000;
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hojeBR = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const somaDias = (iso, n) => new Date(new Date(iso).getTime() + n * DIA).toISOString().slice(0, 10);
const ptBR = (iso) => iso.split("-").reverse().join("/");

// Monta o resumo do dia a partir do que já está no banco.
// Todos os números são calculados aqui, nada é gerado por IA: resumo de dinheiro não pode ter número inventado.
export async function montarResumo() {
  const emp = await empresaPiloto();
  const hoje = hojeBR();
  const desde = new Date(Date.now() - DIA).toISOString();

  const { data: contasRaw } = await db.from("contas_receber").select("*").eq("empresa_id", emp.id);
  const contas = contasRaw || [];
  const abertas = contas.filter((c) => c.status === "aberto");
  const vencidas = abertas
    .filter((c) => c.vencimento < hoje)
    .map((c) => ({ ...c, dias: Math.floor((new Date(hoje) - new Date(c.vencimento)) / DIA) }))
    .sort((a, b) => Number(b.valor) - Number(a.valor));
  const aVencer = abertas.filter((c) => c.vencimento >= hoje && c.vencimento <= somaDias(hoje, 3));

  const totalAberto = abertas.reduce((s, c) => s + Number(c.valor), 0);
  const totalVencido = vencidas.reduce((s, c) => s + Number(c.valor), 0);
  const mediaAtraso = vencidas.length ? Math.round(vencidas.reduce((s, c) => s + c.dias, 0) / vencidas.length) : 0;

  const { data: eventosRaw } = await db.from("eventos").select("tipo, detalhe, criado_em").eq("empresa_id", emp.id).gte("criado_em", desde);
  const eventos = eventosRaw || [];
  const conta = (t) => eventos.filter((e) => e.tipo === t).length;
  const pagas = eventos.filter((e) => e.tipo === "conta_paga");
  const recebido = pagas.reduce((s, e) => s + Number(e.detalhe?.valor || 0), 0);

  const { data: escaladas } = await db
    .from("conversas")
    .select("motivo_escalacao, atualizado_em, clientes(nome, telefone)")
    .eq("empresa_id", emp.id)
    .eq("atendido_por", "humano")
    .order("atualizado_em", { ascending: false })
    .limit(5);

  const { data: contratos } = await db
    .from("contratos")
    .select("cliente_nome, servico, valor_mensal, renovacao")
    .eq("empresa_id", emp.id).eq("status", "ativo")
    .gte("renovacao", hoje).lte("renovacao", somaDias(hoje, 30))
    .order("renovacao", { ascending: true }).limit(5);

  const { data: docsPendentes } = await db
    .from("documentos")
    .select("cliente_nome, tipo, competencia")
    .eq("empresa_id", emp.id).eq("status", "pendente")
    .order("criado_em", { ascending: true }).limit(5);

  const { data: agendamentos } = await db
    .from("agendamentos")
    .select("servico, data_hora, clientes(nome)")
    .eq("empresa_id", emp.id)
    .eq("status", "solicitado")
    .order("criado_em", { ascending: false })
    .limit(5);

  const L = [];
  L.push(`*${emp.nome} · resumo de ${ptBR(hoje)}*`);

  L.push("");
  L.push("*Dinheiro*");
  L.push(`Em aberto: R$ ${brl(totalAberto)}`);
  if (totalVencido > 0) L.push(`Vencido: R$ ${brl(totalVencido)} (${vencidas.length} cliente${vencidas.length > 1 ? "s" : ""}, média de ${mediaAtraso} dias)`);
  else L.push("Vencido: nada em atraso");
  if (recebido > 0) L.push(`Recebido nas últimas 24h: R$ ${brl(recebido)} (${pagas.length})`);
  if (aVencer.length) L.push(`Vence até ${ptBR(somaDias(hoje, 3))}: R$ ${brl(aVencer.reduce((s, c) => s + Number(c.valor), 0))} (${aVencer.length})`);

  if ((contratos || []).length) {
    L.push("");
    L.push("*Contratos a renovar (30 dias)*");
    for (const c of contratos) L.push(`${c.cliente_nome}: ${ptBR(c.renovacao)}${c.valor_mensal ? `, R$ ${brl(c.valor_mensal)}/mês` : ""}`);
  }

  if (vencidas.length) {
    L.push("");
    L.push("*Maiores atrasos*");
    for (const c of vencidas.slice(0, 5)) L.push(`${c.cliente_nome}: R$ ${brl(c.valor)}, ${c.dias} dias`);
  }

  L.push("");
  L.push("*Atendimento nas últimas 24h*");
  const recebidas = conta("mensagem_recebida");
  if (recebidas === 0) L.push("Nenhuma mensagem de cliente");
  else {
    L.push(`${recebidas} ${recebidas > 1 ? "mensagens" : "mensagem"} de cliente`);
    L.push(`${conta("resposta_ia")} respondida${conta("resposta_ia") > 1 ? "s" : ""} pelo agente`);
    if (conta("escalado")) L.push(`${conta("escalado")} passada${conta("escalado") > 1 ? "s" : ""} para a equipe`);
    if (conta("agendamento")) L.push(`${conta("agendamento")} pedido${conta("agendamento") > 1 ? "s" : ""} de agendamento`);
  }
  if (conta("cobranca_enviada")) L.push(`${conta("cobranca_enviada")} lembrete${conta("cobranca_enviada") > 1 ? "s" : ""} de cobrança enviado${conta("cobranca_enviada") > 1 ? "s" : ""}`);

  const pendencias = [];
  for (const c of escaladas || []) pendencias.push(`${c.clientes?.nome || c.clientes?.telefone || "Cliente"} aguarda a equipe${c.motivo_escalacao ? ` (${c.motivo_escalacao})` : ""}`);
  for (const a of agendamentos || []) pendencias.push(`Confirmar ${a.servico} de ${a.clientes?.nome || "cliente"} para ${a.data_hora}`);
  for (const d of docsPendentes || []) pendencias.push(`Emitir ${d.tipo}${d.competencia ? " " + d.competencia : ""} para ${d.cliente_nome || "cliente"}`);
  const unicas = [...new Set(pendencias)];

  L.push("");
  L.push("*Precisa de você hoje*");
  if (!unicas.length) L.push("Nada travado.");
  else for (const p of unicas) L.push(p);

  const usadas = await consumoDoMes(emp.id);
  const limiteMes = teto();
  if (usadas >= limiteMes * 0.8) {
    L.push("");
    L.push(`Mensagens do mês: ${usadas} de ${limiteMes}.`);
  }

  const erros = conta("erro");
  if (erros) {
    L.push("");
    L.push(`Atenção: ${erros} falha${erros > 1 ? "s" : ""} registrada${erros > 1 ? "s" : ""} no sistema nas últimas 24h.`);
  }

  return { texto: L.join("\n"), empresa_id: emp.id };
}

async function gerarEEnviar(enviar) {
  const { texto, empresa_id } = await montarResumo();
  if (!enviar) return { texto, enviado: false };
  if (!process.env.DONO_WHATSAPP) return { texto, enviado: false, erro: "DONO_WHATSAPP não configurado" };
  try {
    await enviarTexto(process.env.DONO_WHATSAPP, texto);
    await registrarEvento(empresa_id, "resumo_enviado", { tamanho: texto.length });
    return { texto, enviado: true };
  } catch (e) {
    // Mensagem livre só sai dentro da janela de 24h desde a última mensagem do dono.
    await registrarEvento(empresa_id, "erro", { gestor: String(e) });
    return { texto, enviado: false, erro: String(e) };
  }
}

// GET: chamado pelo cron da Vercel (Authorization: Bearer CRON_SECRET) ou manualmente com x-senha.
export async function GET(req) {
  const bearer = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  const painel = req.headers.get("x-senha") === process.env.PAINEL_SENHA;
  if (!bearer && !painel) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  return NextResponse.json(await gerarEEnviar(true));
}

// POST: painel. { enviar: false } só devolve a prévia do texto, sem mandar no WhatsApp.
export async function POST(req) {
  if (req.headers.get("x-senha") !== process.env.PAINEL_SENHA) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await gerarEEnviar(body.enviar === true));
}
