import { db, registrarEvento, credenciaisAnuncios, donoDe } from "@/lib/db";
import { enviarTemplate, enviarTexto, normalizarTelefone } from "@/lib/whatsapp";
import { podeEnviar } from "@/lib/limites";
import { lerGoogle } from "@/lib/anuncios/google";
import { lerMeta } from "@/lib/anuncios/meta";

// Agente de marketing: resumo semanal das campanhas de Google Ads e Meta Ads.
// Só lê e recomenda. Todos os números saem das APIs e são calculados aqui,
// nada é gerado por IA: resumo de dinheiro não pode ter número inventado.
//
// Mensagem livre só chega ao dono dentro da janela de 24h desde a última
// mensagem dele, e numa frequência semanal isso quase nunca acontece. Por isso
// o resumo é guardado em resumos_marketing, o dono recebe um template curto
// avisando, e o texto completo sai quando ele responder (entregarResumoPendente,
// chamada pelo webhook).

export const TEMPLATE_AVISO = "resumo_anuncios_pronto";

const DIA = 86400000;
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hojeBR = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const somaDias = (iso, n) => new Date(new Date(iso).getTime() + n * DIA).toISOString().slice(0, 10);
const ddmm = (iso) => iso.slice(5).split("-").reverse().join("/");

// Padrões das regras; cada empresa pode ajustar em empresas.marketing_config.
const CONFIG_PADRAO = {
  gasto_minimo_alerta: 100,     // R$ gasto sem resultado que já merece alerta
  resultados_minimos: 3,        // abaixo disso, custo por resultado é ruído e não entra no ranking
  variacao_alerta: 30,          // % de piora que vira item de "o que olhar"
  resultado_singular: "resultado",
  resultado_plural: "resultados",
};

const MAX_CAMPANHAS = 8;        // o WhatsApp corta texto acima de 4096 caracteres

// Semana fechada de segunda a domingo, anterior a hoje, e a semana antes dela.
// Domingo não conta como "esta semana" porque o dia ainda não terminou.
export function periodos() {
  const hoje = hojeBR();
  const dow = new Date(hoje).getUTCDay();                 // 0 = domingo
  const fim = somaDias(hoje, -(dow === 0 ? 7 : dow));
  const inicio = somaDias(fim, -6);
  return {
    atual: { inicio, fim },
    anterior: { inicio: somaDias(inicio, -7), fim: somaDias(inicio, -1) },
    texto: `${ddmm(inicio)} a ${ddmm(fim)}`,
  };
}

// Quais plataformas a empresa configurou. Coluna faltando = plataforma ignorada.
function plataformas(cred) {
  const lista = [];
  if (cred?.google_ads_customer_id && cred?.google_ads_refresh_token) {
    lista.push({ nome: "Google Ads", ler: (i, f) => lerGoogle({ customerId: cred.google_ads_customer_id, refreshToken: cred.google_ads_refresh_token }, i, f) });
  }
  if (cred?.meta_ad_account_id && cred?.meta_ads_token) {
    lista.push({ nome: "Meta Ads", ler: (i, f) => lerMeta({ contaId: cred.meta_ad_account_id, token: cred.meta_ads_token, tiposResultado: cred.marketing_config?.resultado_meta }, i, f) });
  }
  return lista;
}

const pct = (atual, antes) => (antes > 0 ? Math.round(((atual - antes) / antes) * 100) : null);
const sinal = (p) => (p > 0 ? `+${p}%` : `${p}%`);
const qtd = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
const corta = (t, n = 40) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

// Monta o texto do resumo. Devolve null quando a empresa não tem nenhuma
// plataforma configurada (ignorada em silêncio) e { erro } quando nenhuma leitura deu certo.
export async function montarResumoMarketing(emp) {
  const cred = await credenciaisAnuncios(emp.id);
  const fontes = plataformas(cred);
  if (!fontes.length) return null;

  const cfg = { ...CONFIG_PADRAO, ...(cred.marketing_config || {}) };
  const um = cfg.resultado_singular, varios = cfg.resultado_plural;
  const nRes = (n) => (n === 0 ? `nenhum ${um}` : `${qtd(n)} ${n === 1 ? um : varios}`);
  const P = periodos();

  // Cada plataforma é lida separada: se uma falhar, o resumo sai com a outra.
  const lidas = [];
  const faltou = [];
  for (const f of fontes) {
    try {
      const [atual, anterior] = await Promise.all([f.ler(P.atual.inicio, P.atual.fim), f.ler(P.anterior.inicio, P.anterior.fim)]);
      lidas.push({ nome: f.nome, atual, anterior });
    } catch (e) {
      await registrarEvento(emp.id, "erro", { marketing: f.nome, erro: String(e) });
      faltou.push(f.nome);
    }
  }
  if (!lidas.length) return { erro: `não consegui ler ${faltou.join(" nem ")}` };

  // Moedas diferentes não se somam. Conta em BRL é o normal; outra moeda aparece com o código.
  const moedas = [...new Set(lidas.map((l) => l.atual.moeda || l.anterior.moeda || "BRL"))];
  const moeda = moedas.length === 1 ? moedas[0] : null;
  const dinheiro = (v, m = moeda) => (m === "BRL" || !m ? `R$ ${brl(v)}` : `${m} ${brl(v)}`);

  // Cada campanha leva a moeda da conta dela, para a linha sair com o símbolo certo.
  const campanhas = lidas.flatMap((l) => l.atual.campanhas.map((c) => ({ ...c, moeda: l.atual.moeda })));
  const anteriores = new Map(lidas.flatMap((l) => l.anterior.campanhas).map((c) => [`${c.plataforma}|${c.id}`, c]));
  const soma = (lista, campo) => lista.reduce((s, c) => s + c[campo], 0);
  const gasto = soma(campanhas, "gasto"), gastoAntes = soma(lidas.flatMap((l) => l.anterior.campanhas), "gasto");
  const res = soma(campanhas, "resultados"), resAntes = soma(lidas.flatMap((l) => l.anterior.campanhas), "resultados");
  const custo = (c) => (c.resultados > 0 ? c.gasto / c.resultados : null);

  const L = [];
  L.push(`*${emp.nome} · anúncios de ${P.texto}*`);
  if (faltou.length) {
    L.push("");
    L.push(`Não consegui ler o ${faltou.join(" nem o ")} esta semana. Os números abaixo são só do ${lidas.map((l) => l.nome).join(" e do ")}.`);
  }

  L.push("");
  L.push("*Investimento*");
  if (!moeda) {
    // Sem total: somar reais com dólares daria um número errado.
    for (const l of lidas) L.push(`${l.nome}: ${dinheiro(soma(l.atual.campanhas, "gasto"), l.atual.moeda)}`);
  } else {
    const v = pct(gasto, gastoAntes);
    L.push(`Total: ${dinheiro(gasto)} (semana anterior: ${gastoAntes > 0 ? `${dinheiro(gastoAntes)}, ${sinal(v)}` : "sem gasto"})`);
    if (lidas.length > 1) L.push(lidas.map((l) => `${l.nome}: ${dinheiro(soma(l.atual.campanhas, "gasto"))}`).join(" · "));
    if (res > 0) {
      const antes = resAntes > 0 ? ` (anterior: ${dinheiro(gastoAntes / resAntes)})` : "";
      L.push(`${varios[0].toUpperCase() + varios.slice(1)}: ${qtd(res)}, ${dinheiro(gasto / res)} por ${um}${antes}`);
    } else if (gasto > 0) {
      L.push(`Nenhum ${um} registrado na semana`);
    }
  }

  if (!campanhas.length) {
    L.push("");
    L.push("Nenhuma campanha teve gasto nesta semana.");
  } else {
    const porGasto = [...campanhas].sort((a, b) => b.gasto - a.gasto);
    L.push("");
    L.push("*Por campanha*");
    for (const c of porGasto.slice(0, MAX_CAMPANHAS)) {
      const cpr = custo(c);
      L.push(`${c.plataforma} · ${corta(c.nome)}: ${dinheiro(c.gasto, c.moeda)}, ${nRes(c.resultados)}${cpr != null ? `, ${dinheiro(cpr, c.moeda)} por ${um}` : ""}`);
    }
    if (porGasto.length > MAX_CAMPANHAS) L.push(`e mais ${porGasto.length - MAX_CAMPANHAS} campanha(s) com gasto menor`);

    // Melhor custo por resultado, só entre quem teve volume para a comparação valer.
    // Com moedas diferentes não há ranking: comparar custo em real com custo em dólar engana.
    const comVolume = moeda ? campanhas.filter((c) => c.resultados >= cfg.resultados_minimos).sort((a, b) => custo(a) - custo(b)) : [];
    if (comVolume.length) {
      L.push("");
      L.push(`*Melhor custo por ${um}*`);
      for (const c of comVolume.slice(0, 2)) L.push(`${c.plataforma} · ${corta(c.nome)}: ${dinheiro(custo(c))} por ${um} (${nRes(c.resultados)})`);
    }

    // Em conta pequena, R$ 100 sem resultado nunca aconteceria; 15% do gasto da
    // semana também conta, com piso de R$ 20 para não alertar sobre centavos.
    const limiteSemRetorno = Math.min(cfg.gasto_minimo_alerta, Math.max(gasto * 0.15, 20));
    const semRetorno = porGasto.filter((c) => c.resultados === 0 && c.gasto >= limiteSemRetorno);
    if (semRetorno.length) {
      L.push("");
      L.push("*Gastando sem retorno*");
      for (const c of semRetorno.slice(0, 5)) L.push(`${c.plataforma} · ${corta(c.nome)}: ${dinheiro(c.gasto, c.moeda)} na semana, ${nRes(0)}`);
    }

    // Recomendações por regra fixa. Apontam o que olhar; nunca prometem ação,
    // porque o sistema não mexe em campanha.
    const olhar = [];
    for (const c of semRetorno.slice(0, 2)) olhar.push(`A campanha ${corta(c.nome)} (${c.plataforma}) gastou ${dinheiro(c.gasto, c.moeda)} sem gerar ${um}. Vale revisar público, anúncio e página de destino.`);
    for (const c of comVolume) {
      const a = anteriores.get(`${c.plataforma}|${c.id}`);
      if (!a || a.resultados < cfg.resultados_minimos) continue;
      const v = pct(custo(c), custo(a));
      if (v >= cfg.variacao_alerta) olhar.push(`O custo por ${um} de ${corta(c.nome)} (${c.plataforma}) subiu ${v}%: de ${dinheiro(custo(a))} para ${dinheiro(custo(c))}.`);
    }
    const vGasto = pct(gasto, gastoAntes);
    if (moeda && vGasto >= cfg.variacao_alerta && res <= resAntes) {
      olhar.push(`O gasto subiu ${vGasto}% e os ${varios} não acompanharam (${qtd(resAntes)} na semana anterior, ${qtd(res)} nesta).`);
    }
    if (comVolume.length > 1) olhar.push(`${corta(comVolume[0].nome)} teve o menor custo por ${um} da semana. Vale ver o que ela tem de diferente das outras.`);

    L.push("");
    L.push("*O que olhar*");
    if (!olhar.length) L.push("Nada fora do padrão nesta semana.");
    else for (const o of olhar.slice(0, 4)) L.push(o);
  }

  L.push("");
  L.push("As plataformas registram conversões com alguns dias de atraso, então a semana mais recente tende a parecer um pouco pior do que foi.");
  L.push("Resumo só de leitura: nenhuma campanha ou orçamento foi alterado.");

  return { texto: L.join("\n"), periodo: P.texto };
}

// Monta o resumo, guarda como pendente e manda o template de aviso ao dono.
// Nunca lança erro: quem chama percorre várias empresas e uma não pode derrubar as outras.
export async function prepararEAvisar(emp) {
  const cred = await credenciaisAnuncios(emp.id);
  if (!plataformas(cred).length) return { ignorada: true };

  // O cron da Vercel pode disparar duas vezes; não gera nem avisa de novo a mesma semana.
  const { texto: periodo } = periodos();
  const { data: jaTem } = await db.from("resumos_marketing").select("id")
    .eq("empresa_id", emp.id).eq("periodo", periodo).in("status", ["pendente", "enviando", "enviado"]).limit(1);
  if ((jaTem || []).length) return { ignorada: true, motivo: "resumo desta semana já preparado" };

  const dono = donoDe(emp);
  if (!dono) return { enviado: false, erro: "empresa sem dono_whatsapp configurado" };

  const resumo = await montarResumoMarketing(emp);
  if (!resumo) return { ignorada: true };
  if (resumo.erro) return { enviado: false, erro: resumo.erro };

  // São duas mensagens (o aviso e o resumo); só começa se couberem as duas no teto.
  const lim = await podeEnviar(emp);
  if (!lim.ok || lim.usadas + 2 > lim.limite) {
    await registrarEvento(emp.id, "teto_atingido", { usadas: lim.usadas, limite: lim.limite, marketing: true });
    return { enviado: false, erro: `teto de mensagens do mês atingido (${lim.usadas}/${lim.limite})` };
  }

  // Resumo da semana passada que o dono não pediu perde a validade: só vale o mais recente.
  await db.from("resumos_marketing").update({ status: "expirado" }).eq("empresa_id", emp.id).eq("status", "pendente");
  const { data: linha, error } = await db.from("resumos_marketing")
    .insert({ empresa_id: emp.id, periodo, texto: resumo.texto }).select("id").single();
  if (error) return { enviado: false, erro: error.message };

  try {
    await enviarTemplate(emp, dono, TEMPLATE_AVISO, [emp.nome, periodo]);
    await registrarEvento(emp.id, "resumo_marketing_aviso", { periodo });
    return { enviado: true };
  } catch (e) {
    // Sem aviso o dono não sabe que precisa responder; marca como falha para
    // uma nova tentativa (pelo painel ou no próximo cron) não ser barrada acima.
    await db.from("resumos_marketing").update({ status: "falhou" }).eq("id", linha.id);
    await registrarEvento(emp.id, "erro", { marketing: "aviso", erro: String(e) });
    return { enviado: false, erro: String(e) };
  }
}

// Chamada pelo webhook para toda mensagem recebida. Se quem escreveu é o dono
// e há resumo esperando, entrega e devolve true (a mensagem não vai para a IA,
// senão o atendente virtual responderia o "ok" do dono como se fosse cliente).
// Devolve false em qualquer outro caso, e o webhook segue como sempre.
export async function entregarResumoPendente(empresa, telefone, wa_message_id) {
  const dono = donoDe(empresa);
  if (!dono || normalizarTelefone(dono) !== normalizarTelefone(telefone)) return false;

  // A Meta reenvia o mesmo evento quando demora a receber o 200. Se esta
  // mensagem já disparou uma entrega, não pode cair na IA nem entregar de novo.
  const { data: jaUsada } = await db.from("resumos_marketing").select("id").eq("resposta_wa_id", wa_message_id).limit(1);
  if ((jaUsada || []).length) return true;

  const semana = new Date(Date.now() - 7 * DIA).toISOString();
  const { data: pendente } = await db.from("resumos_marketing").select("id, texto")
    .eq("empresa_id", empresa.id).eq("status", "pendente").gte("criado_em", semana)
    .order("criado_em", { ascending: false }).limit(1).maybeSingle();
  if (!pendente) return false;

  // Reserva o resumo antes de enviar: se duas mensagens do dono chegarem juntas,
  // só uma consegue a reserva e o resumo sai uma vez só.
  const { data: reservado } = await db.from("resumos_marketing")
    .update({ status: "enviando", resposta_wa_id: wa_message_id })
    .eq("id", pendente.id).eq("status", "pendente").select("id");
  if (!(reservado || []).length) return true;

  const lim = await podeEnviar(empresa);
  if (!lim.ok) {
    await db.from("resumos_marketing").update({ status: "pendente", resposta_wa_id: null }).eq("id", pendente.id);
    await registrarEvento(empresa.id, "teto_atingido", { usadas: lim.usadas, limite: lim.limite, marketing: true });
    return true;
  }
  try {
    await enviarTexto(empresa, dono, pendente.texto);
    await db.from("resumos_marketing").update({ status: "enviado", enviado_em: new Date().toISOString() }).eq("id", pendente.id);
    await registrarEvento(empresa.id, "resumo_marketing_enviado", { tamanho: pendente.texto.length });
  } catch (e) {
    // Volta para pendente: a próxima mensagem do dono tenta de novo.
    await db.from("resumos_marketing").update({ status: "pendente", resposta_wa_id: null }).eq("id", pendente.id);
    await registrarEvento(empresa.id, "erro", { marketing: "entrega", erro: String(e) });
  }
  return true;
}
