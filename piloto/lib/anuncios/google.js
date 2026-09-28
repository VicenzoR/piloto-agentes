// Leitura do Google Ads. SÓ LEITURA: este módulo não tem, e não deve ganhar,
// nenhuma função que crie, pause ou altere campanha ou orçamento. Um erro aqui
// gasta dinheiro real do cliente. A segunda trava fica do lado do Google: o
// usuário da agência é convidado na conta do cliente com acesso "Somente leitura",
// porque o escopo OAuth do Google Ads não tem versão só de leitura.

// Versão fixa da API. O Google aposenta versões mais ou menos uma vez por ano;
// quando esta for descontinuada, as leituras passam a falhar e é aqui que se troca.
const API = "https://googleads.googleapis.com/v25";

// Credenciais da agência (as mesmas para todos os clientes). O que é de cada
// empresa (id da conta e refresh token) vem da tabela empresas.
function credenciaisAgencia() {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!developerToken || !clientId || !clientSecret) throw new Error("Google Ads: credenciais da agência não configuradas");
  return { developerToken, clientId, clientSecret };
}

async function accessToken(refreshToken, { clientId, clientSecret }) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Google Ads token: " + (j.error_description || j.error || r.status));
  return j.access_token;
}

// Único ponto que fala com a API de dados. O Google usa POST também para
// consultar, então o que garante a leitura é o endpoint: googleAds:search, fixo
// aqui. Alterações passam por endpoints :mutate, que este módulo nunca chama.
async function consultar(customerId, query, token, developerToken) {
  const caminho = `/customers/${customerId}/googleAds:search`;
  const linhas = [];
  let pageToken;
  do {
    const r = await fetch(API + caminho, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "developer-token": developerToken, "Content-Type": "application/json" },
      body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error("Google Ads: " + JSON.stringify(j.error?.message || j).slice(0, 300));
    linhas.push(...(j.results || []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return linhas;
}

// Gasto e resultado por campanha no período (datas AAAA-MM-DD, no fuso da conta).
// Devolve o mesmo formato do Meta, para o resumo não precisar saber de onde veio.
export async function lerGoogle({ customerId, refreshToken }, inicio, fim) {
  const agencia = credenciaisAgencia();
  const id = String(customerId).replace(/\D/g, "");   // o cliente costuma copiar com traços
  const token = await accessToken(refreshToken, agencia);
  const query = `
    SELECT customer.currency_code, campaign.id, campaign.name,
           metrics.cost_micros, metrics.clicks, metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${inicio}' AND '${fim}'
      AND metrics.cost_micros > 0`;
  const linhas = await consultar(id, query, token, agencia.developerToken);
  return {
    moeda: linhas[0]?.customer?.currencyCode || null,
    campanhas: linhas.map((l) => ({
      plataforma: "Google",
      id: String(l.campaign?.id),
      nome: l.campaign?.name || "sem nome",
      gasto: Number(l.metrics?.costMicros || 0) / 1e6,
      cliques: Number(l.metrics?.clicks || 0),
      resultados: Number(l.metrics?.conversions || 0),
    })),
  };
}
