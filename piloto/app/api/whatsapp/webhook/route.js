import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import crypto from "crypto";
import { empresaPiloto, obterConversa, salvarMensagem, historico, registrarEvento, db } from "@/lib/db";
import { enviarTexto } from "@/lib/whatsapp";
import { responder } from "@/lib/agente";
import { podeEnviar } from "@/lib/limites";

// Verificação do webhook (Meta chama uma vez ao configurar)
export async function GET(req) {
  const u = new URL(req.url);
  if (u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(u.searchParams.get("hub.challenge"), { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// Confere a assinatura que a Meta manda em cada webhook.
// Sem isso, qualquer um que descubra a URL consegue injetar mensagem falsa e
// fazer o sistema criar cobrança, agendamento ou responder por nós.
// Precisa do corpo CRU: JSON.stringify do objeto já parseado não bate a assinatura.
function assinaturaValida(cru, cabecalho) {
  const segredo = process.env.META_APP_SECRET;
  if (!segredo) return false;               // sem segredo configurado, recusa
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = "sha256=" + crypto.createHmac("sha256", segredo).update(cru, "utf8").digest("hex");
  const a = Buffer.from(esperado), b = Buffer.from(cabecalho);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Mensagens recebidas
export async function POST(req) {
  const cru = await req.text();
  if (!assinaturaValida(cru, req.headers.get("x-hub-signature-256"))) {
    console.error("webhook com assinatura invalida");
    return new Response("forbidden", { status: 403 });
  }
  let body;
  try { body = JSON.parse(cru); } catch { return NextResponse.json({ ok: true }); }

  const empresa = await empresaPiloto();
  try {
    const value = body?.entry?.[0]?.changes?.[0]?.value;

    // Coexistência: o número continua no celular do cliente. Quando alguém da
    // equipe responde por lá, a Meta manda uma cópia aqui como eco.
    // Sem tratar isso, a IA responde por cima do funcionário.
    const eco = value?.message_echoes?.[0];
    if (eco) {
      const paraQuem = eco.to || eco.recipient_id;
      const textoEco = eco.text?.body || `[${eco.type}]`;
      if (paraQuem) {
        const { cliente, conversa } = await obterConversa(empresa.id, paraQuem, null);
        const { data: jaTem } = await db.from("mensagens").select("id").eq("wa_message_id", eco.id).maybeSingle();
        if (!jaTem) {
          await salvarMensagem(conversa.id, "humano", textoEco, eco.id);
          await db.from("conversas").update({ atendido_por: "humano" }).eq("id", conversa.id);
          await registrarEvento(empresa.id, "humano_respondeu_no_celular", { telefone: paraQuem });
        }
      }
      return NextResponse.json({ ok: true });
    }

    const msg = value?.messages?.[0];
    if (!msg || msg.type !== "text") return NextResponse.json({ ok: true }); // status de entrega, mídia etc.

    const telefone = msg.from;
    const nome = value?.contacts?.[0]?.profile?.name;
    const texto = msg.text.body;

    // A Meta reenvia o mesmo evento quando demora a receber o 200.
    // Sem esta trava, a mesma mensagem é processada de novo e as ações se repetem.
    const { data: jaProcessada } = await db.from("mensagens").select("id").eq("wa_message_id", msg.id).maybeSingle();
    if (jaProcessada) return NextResponse.json({ ok: true });

    const { cliente, conversa } = await obterConversa(empresa.id, telefone, nome);
    await salvarMensagem(conversa.id, "cliente", texto, msg.id);
    await registrarEvento(empresa.id, "mensagem_recebida", { telefone, texto });

    // Conversa assumida por um atendente de verdade: a IA fica em silêncio.
    // Escalação automática (sem ninguém ter assumido) não silencia a IA: ela
    // segue respondendo o que está no catálogo, e só o assunto escalado fica com a equipe.
    if (conversa.atendido_por === "humano") return NextResponse.json({ ok: true });

    // Teto de mensagens do mês: para de responder e avisa o dono uma vez.
    const limite = await podeEnviar(empresa.id);
    if (!limite.ok) {
      await registrarEvento(empresa.id, "teto_atingido", { usadas: limite.usadas, limite: limite.limite });
      if (limite.primeiraVez) await avisarDono(`Teto de mensagens do mês atingido (${limite.usadas}/${limite.limite}). O atendimento automático está pausado até a virada do mês ou até o limite ser ampliado.`);
      return NextResponse.json({ ok: true });
    }

    const hist = await historico(conversa.id);
    const { resposta, acoes } = await responder(hist);

    for (const a of acoes) {
      if (a.tipo === "registrar_agendamento") {
        // Não registra nem avisa duas vezes o mesmo pedido ainda pendente.
        const { data: pendente } = await db.from("agendamentos").select("id")
          .eq("cliente_id", cliente.id).eq("servico", a.dados.servico)
          .eq("data_hora", a.dados.data_hora).eq("status", "solicitado").maybeSingle();
        if (!pendente) {
          await db.from("agendamentos").insert({ empresa_id: empresa.id, cliente_id: cliente.id, servico: a.dados.servico, data_hora: a.dados.data_hora });
          await db.from("conversas").update({ estagio: "Em atendimento" }).eq("id", conversa.id);
          await registrarEvento(empresa.id, "agendamento", a.dados);
          // Fica no histórico para o agente saber que já registrou e não repetir na próxima mensagem.
          await salvarMensagem(conversa.id, "sistema", `Agendamento já registrado: ${a.dados.servico} para ${a.dados.data_hora}. Não registrar de novo.`);
          await avisarDono(`Novo pedido de agendamento\nCliente: ${nome || telefone}\nServiço: ${a.dados.servico}\nQuando: ${a.dados.data_hora}\nConfirme com o cliente.`);
        }
      }
      if (a.tipo === "pedir_documento") {
        const comp = a.dados.competencia || "";
        // Se o documento já existe na base, manda o link direto para o cliente.
        const { data: doc } = await db.from("documentos").select("*")
          .eq("empresa_id", empresa.id).eq("cliente_id", cliente.id)
          .eq("tipo", a.dados.tipo).eq("competencia", comp)
          .eq("status", "disponivel").maybeSingle();
        if (doc?.link) {
          await enviarTexto(telefone, `Seu ${doc.tipo}${comp ? " de " + comp : ""} está aqui: ${doc.link}`);
          await db.from("documentos").update({ status: "entregue" }).eq("id", doc.id);
          await registrarEvento(empresa.id, "documento_entregue", { tipo: doc.tipo, competencia: comp });
        } else {
          await db.from("documentos").insert({ empresa_id: empresa.id, cliente_id: cliente.id, cliente_nome: cliente.nome || telefone, tipo: a.dados.tipo, competencia: comp });
          await registrarEvento(empresa.id, "documento_pedido", a.dados);
          await salvarMensagem(conversa.id, "sistema", `Pedido de ${a.dados.tipo}${comp ? " " + comp : ""} já registrado para a equipe. Não registrar de novo.`);
          await avisarDono(`Documento pedido\nCliente: ${nome || telefone}\nTipo: ${a.dados.tipo}${comp ? "\nCompetência: " + comp : ""}\nProvidencie e envie ao cliente.`);
        }
      }
      if (a.tipo === "registrar_negociacao") {
        await registrarEvento(empresa.id, "negociacao", { ...a.dados, telefone });
        await salvarMensagem(conversa.id, "sistema", `Parcelamento proposto: ${a.dados.valor_total} em ${a.dados.parcelas}x. Aguardando a equipe confirmar.`);
        await avisarDono(`Parcelamento combinado (falta confirmar)\nCliente: ${nome || telefone} (wa.me/${telefone})\nValor: ${a.dados.valor_total}\nParcelas: ${a.dados.parcelas}x${a.dados.observacao ? "\nObs: " + a.dados.observacao : ""}`);
      }
      if (a.tipo === "chamar_equipe") {
        // Se o mesmo assunto já está com a equipe, não avisa de novo.
        if (conversa.motivo_escalacao !== a.dados.motivo) {
          await db.from("conversas").update({ motivo_escalacao: a.dados.motivo }).eq("id", conversa.id);
          await salvarMensagem(conversa.id, "sistema", `Assunto já passado para a equipe: ${a.dados.motivo}. Não escalar de novo.`);
          await registrarEvento(empresa.id, "escalado", { telefone, motivo: a.dados.motivo });
          await avisarDono(`Cliente precisa de você\n${nome || telefone} (wa.me/${telefone})\nMotivo: ${a.dados.motivo}\nÚltima mensagem: "${texto}"`);
        }
      }
    }

    if (resposta) {
      const waId = await enviarTexto(telefone, resposta);
      await salvarMensagem(conversa.id, "ia", resposta, waId);
      await registrarEvento(empresa.id, "resposta_ia", { telefone, resposta });
    }
  } catch (e) {
    console.error(e);
    await registrarEvento(empresa?.id, "erro", { erro: String(e) });
    await avisarDono("O atendimento automático falhou em uma mensagem. Verifique o WhatsApp da empresa.").catch(() => {});
  }
  return NextResponse.json({ ok: true }); // sempre 200, senão a Meta reenvia
}

async function avisarDono(texto) {
  if (!process.env.DONO_WHATSAPP) return;
  await enviarTexto(process.env.DONO_WHATSAPP, texto);
}
