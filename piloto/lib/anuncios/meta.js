// Leitura do Meta Ads. SÓ LEITURA: este módulo não tem, e não deve ganhar,
// nenhuma função que crie, pause ou altere campanha ou orçamento. Um erro aqui
// gasta dinheiro real do cliente. A segunda trava fica do lado da Meta: o token
// da empresa deve ter só a permissão ads_read, que não permite alterar nada.

// Versão fixa da API. A Meta aposenta versões cerca de dois anos depois do
// lançamento; quando esta sair, as leituras passam a falhar e é aqui que se troca.
const API = "https://graph.facebook.com/v26.0";

// O que conta como "resultado" quando a empresa não configurou nada.
// Lead e conversa iniciada no WhatsApp são os objetivos mais comuns dos nossos clientes.
export const RESULTADOS_META_PADRAO = ["lead", "onsite_conversion.messaging_conversation_started_7d"];

// Único ponto que fala com a API, e só com GET: na Graph API, criar ou alterar
// é POST ou DELETE, que este módulo nunca faz.
// O token vai no cabeçalho e não na URL, para não aparecer em log quando a
// URL de paginação ou uma mensagem de erro for registrada.
async function ler(url, token) {
  const r = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) throw new Error("Meta Ads: " + JSON.stringify(j.error?.message || j).slice(0, 300));
  return j;
}

// Gasto e resultado por campanha no período (datas AAAA-MM-DD, no fuso da conta).
export async function lerMeta({ contaId, token, tiposResultado }, inicio, fim) {
  const conta = String(contaId).replace(/^act_/, "");
  const tipos = tiposResultado?.length ? tiposResultado : RESULTADOS_META_PADRAO;
  const params = new URLSearchParams({
    level: "campaign",
    time_range: JSON.stringify({ since: inicio, until: fim }),
    fields: "campaign_id,campaign_name,spend,clicks,actions,account_currency",
    limit: "500",
  });
  const linhas = [];
  let url = `${API}/act_${conta}/insights?${params}`;
  while (url) {
    const j = await ler(url, token);
    linhas.push(...(j.data || []));
    url = j.paging?.next || null;
  }
  return {
    moeda: linhas[0]?.account_currency || null,
    campanhas: linhas
      .filter((l) => Number(l.spend) > 0)
      .map((l) => ({
        plataforma: "Meta",
        id: String(l.campaign_id),
        nome: l.campaign_name || "sem nome",
        gasto: Number(l.spend || 0),
        cliques: Number(l.clicks || 0),
        resultados: (l.actions || []).filter((a) => tipos.includes(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0),
      })),
  };
}
