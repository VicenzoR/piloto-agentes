import Anthropic from "@anthropic-ai/sdk";

let _client;
const client = { messages: { create: (...a) => (_client ||= new Anthropic()).messages.create(...a) } };

const bloco = (titulo, linhas) => (linhas && linhas.length ? `\n\n${titulo}\n${linhas.join("\n")}` : "");

// O prompt é montado a partir do catálogo DA EMPRESA daquela conversa.
// Antes vinha de um arquivo só, então duas empresas responderiam com os mesmos
// serviços e preços.
function montarSystem(empresa) {
const NEGOCIACAO = empresa.negociacao ? [
  empresa.negociacao.regra,
  `Parcelamento: ${empresa.negociacao.aceita_parcelamento ? `até ${empresa.negociacao.max_parcelas}x` : "não oferecemos"}.`,
  `Desconto máximo sem autorização: ${empresa.negociacao.desconto_maximo_percent || 0}%.`,
  "Ao combinar parcelamento dentro do limite, use registrar_negociacao. Fora do limite, use chamar_equipe.",
].filter(Boolean) : [];

const DOCUMENTOS = empresa.documentos ? [
  `Tipos: ${empresa.documentos.tipos.join(", ")}.`,
  `Prazo de emissão: ${empresa.documentos.prazo_emissao}.`,
  `Entrega: ${empresa.documentos.onde}.`,
  "Quando o cliente pedir ou cobrar um documento, use pedir_documento com o tipo e a competência (mês). Nunca afirme que o documento já foi emitido.",
] : [];

const CONTRATOS = empresa.contratos ? [
  `Prazo padrão: ${empresa.contratos.prazo_padrao}.`,
  "Dúvida sobre valor, reajuste, cancelamento ou renovação de contrato vai para a equipe.",
] : [];

const SYSTEM = `Você é o atendente virtual da ${empresa.nome} (${empresa.cidade}) no WhatsApp.

REGRAS ABSOLUTAS
- Só informe preços, serviços, horários, endereço e formas de pagamento que estejam no CATÁLOGO abaixo. Se não estiver lá, não invente: use a ferramenta chamar_equipe.
- Nunca: ${(empresa.temas_proibidos || []).join("; ")}.
- Se o cliente pedir desconto, condição especial, reclamar ou parecer irritado, use chamar_equipe.
- Se o cliente quiser marcar horário, colete serviço e dia/horário desejado e use registrar_agendamento. Diga que a equipe vai confirmar.
- Se o cliente escrever SAIR, use chamar_equipe com motivo "opt-out" e responda apenas que ele não receberá mais mensagens.
- Responda curto (máximo 3 frases), em português informal e educado, sem emojis em excesso, sem markdown.
- Na primeira mensagem, diga que é o atendimento automático da empresa.

COMO ESCALAR
- Quando precisar chamar a equipe, chame na mesma mensagem, sem perguntar antes se o cliente quer. Nada de "posso chamar alguém?" ou "o que você prefere?".
- Ao escalar, diga em uma frase que não tem essa informação e que um atendente vai responder em breve. Depois pare o assunto.
- Você continua respondendo normalmente outras perguntas que estejam no catálogo, mesmo depois de ter escalado antes. Só não insista no assunto que foi passado para a equipe.

CATÁLOGO
Horário: ${empresa.horario}
Endereço: ${empresa.endereco}
Pagamento: ${empresa.pagamento}
Políticas: ${(empresa.politicas || []).join(" ")}
Serviços:
${(empresa.servicos || []).map((s) => `- ${s.nome}: R$ ${s.preco} (${s.duracao})`).join("\n")}`
  + bloco("NEGOCIAÇÃO", NEGOCIACAO)
  + bloco("DOCUMENTOS", DOCUMENTOS)
  + bloco("CONTRATO", CONTRATOS);
  return SYSTEM;
}

const TOOLS = [
  {
    name: "registrar_agendamento",
    description: "Registra um pedido de agendamento para a equipe confirmar.",
    input_schema: { type: "object", properties: { servico: { type: "string" }, data_hora: { type: "string", description: "Dia e horário como o cliente disse" } }, required: ["servico", "data_hora"] },
  },
  {
    name: "pedir_documento",
    description: "Registra um pedido de documento regulatório (MTR, CDF, certificado, laudo) para a equipe providenciar.",
    input_schema: { type: "object", properties: { tipo: { type: "string" }, competencia: { type: "string", description: "Mês ou referência que o cliente citou, ex: 09/2026" } }, required: ["tipo"] },
  },
  {
    name: "registrar_negociacao",
    description: "Registra um parcelamento combinado dentro do limite autorizado, para a equipe confirmar.",
    input_schema: { type: "object", properties: { valor_total: { type: "string" }, parcelas: { type: "number" }, observacao: { type: "string" } }, required: ["valor_total", "parcelas"] },
  },
  {
    name: "chamar_equipe",
    description: "Passa a conversa para um atendente humano quando você não deve ou não consegue responder.",
    input_schema: { type: "object", properties: { motivo: { type: "string" } }, required: ["motivo"] },
  },
];

// Retorna { resposta, acoes: [{tipo, dados}] }
// catalogo = o objeto da empresa (tabela empresas.catalogo)
export async function responder(historicoMsgs, catalogo) {
  const SYSTEM = montarSystem(catalogo || {});
  // As notas de sistema entram como fala do assistente: é assim que o modelo sabe
  // que um agendamento ou uma escalação JÁ foi executada e não deve ser refeita.
  const messages = historicoMsgs.map((m) => {
    if (m.autor === "cliente") return { role: "user", content: m.texto };
    if (m.autor === "sistema") return { role: "assistant", content: `(nota interna do sistema: ${m.texto})` };
    return { role: "assistant", content: m.texto };
  });
  // A API exige começar com user e alternar; junta mensagens seguidas do mesmo papel.
  const compact = [];
  for (const m of messages) {
    const last = compact[compact.length - 1];
    if (last && last.role === m.role) last.content += "\n" + m.content; else compact.push({ ...m });
  }
  if (compact.length === 0 || compact[0].role !== "user") compact.unshift({ role: "user", content: "(início da conversa)" });

  const acoes = [];
  let resposta = "";
  let msgs = compact;
  for (let i = 0; i < 3; i++) {
    const r = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 400, system: SYSTEM, tools: TOOLS, messages: msgs });
    // Só o texto da última rodada vai para o cliente. O texto das rodadas
    // intermediárias é preâmbulo ("vou registrar...") e, somado, sai grudado.
    let textoRodada = "";
    for (const b of r.content) {
      if (b.type === "text") textoRodada += b.text;
      if (b.type === "tool_use") acoes.push({ tipo: b.name, dados: b.input, id: b.id });
    }
    if (textoRodada.trim()) resposta = textoRodada;
    if (r.stop_reason !== "tool_use") break;
    msgs = [...msgs, { role: "assistant", content: r.content },
      { role: "user", content: r.content.filter((b) => b.type === "tool_use").map((b) => ({ type: "tool_result", tool_use_id: b.id, content: "ok, registrado" })) }];
  }
  return { resposta: resposta.trim(), acoes };
}
