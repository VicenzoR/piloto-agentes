import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { empresaPiloto, obterConversa, salvarMensagem, historico, registrarEvento, db } from "@/lib/db";
import { enviarTexto } from "@/lib/whatsapp";
import { responder } from "@/lib/agente";

// Verificação do webhook (Meta chama uma vez ao configurar)
export async function GET(req) {
  const u = new URL(req.url);
  if (u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(u.searchParams.get("hub.challenge"), { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// Mensagens recebidas
export async function POST(req) {
  const body = await req.json();
  const empresa = await empresaPiloto();
  try {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg || msg.type !== "text") return NextResponse.json({ ok: true }); // status de entrega, mídia etc.

    const telefone = msg.from;
    const nome = value?.contacts?.[0]?.profile?.name;
    const texto = msg.text.body;

    const { cliente, conversa } = await obterConversa(empresa.id, telefone, nome);
    await salvarMensagem(conversa.id, "cliente", texto, msg.id);
    await registrarEvento(empresa.id, "mensagem_recebida", { telefone, texto });

    // Conversa já está com humano: só grava e avisa
    if (conversa.atendido_por === "humano") return NextResponse.json({ ok: true });

    const hist = await historico(conversa.id);
    const { resposta, acoes } = await responder(hist);

    for (const a of acoes) {
      if (a.tipo === "registrar_agendamento") {
        await db.from("agendamentos").insert({ empresa_id: empresa.id, cliente_id: cliente.id, servico: a.dados.servico, data_hora: a.dados.data_hora });
        await db.from("conversas").update({ estagio: "Em atendimento" }).eq("id", conversa.id);
        await registrarEvento(empresa.id, "agendamento", a.dados);
        await avisarDono(`Novo pedido de agendamento\nCliente: ${nome || telefone}\nServiço: ${a.dados.servico}\nQuando: ${a.dados.data_hora}\nConfirme com o cliente.`);
      }
      if (a.tipo === "chamar_equipe") {
        await db.from("conversas").update({ atendido_por: "humano", motivo_escalacao: a.dados.motivo }).eq("id", conversa.id);
        await salvarMensagem(conversa.id, "sistema", "Conversa passada para a equipe: " + a.dados.motivo);
        await registrarEvento(empresa.id, "escalado", { telefone, motivo: a.dados.motivo });
        await avisarDono(`Cliente precisa de você\n${nome || telefone} (wa.me/${telefone})\nMotivo: ${a.dados.motivo}\nÚltima mensagem: "${texto}"`);
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
