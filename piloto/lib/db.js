import { createClient } from "@supabase/supabase-js";
import catalogoPadrao from "../config/empresa.json";

let _db;
function getDb() {
  if (!_db) _db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return _db;
}
// Cliente criado só na primeira chamada (evita erro no build sem variáveis de ambiente)
export const db = { from: (t) => getDb().from(t) };

const CAMPOS_EMPRESA = "id, nome, slug, phone_number_id, whatsapp_token, dono_whatsapp, senha_painel, teto_mensagens, catalogo, ativa";

// ---------- empresas ----------
// Cada empresa tem o próprio número de WhatsApp, o próprio catálogo e o próprio
// dono. Nada disso pode vir de variável de ambiente ou de arquivo, senão duas
// empresas compartilham a mesma configuração.

export async function empresaPorPhoneId(phone_number_id) {
  if (!phone_number_id) return null;
  const { data } = await db.from("empresas").select(CAMPOS_EMPRESA).eq("phone_number_id", String(phone_number_id)).maybeSingle();
  return data || null;
}

export async function empresaPorId(id) {
  const { data } = await db.from("empresas").select(CAMPOS_EMPRESA).eq("id", id).maybeSingle();
  return data || null;
}

export async function empresaPorSlug(slug) {
  const { data } = await db.from("empresas").select(CAMPOS_EMPRESA).eq("slug", slug).maybeSingle();
  return data || null;
}

export async function listarEmpresas() {
  const { data } = await db.from("empresas").select(CAMPOS_EMPRESA).order("nome");
  return (data || []).filter((e) => e.ativa !== false);
}

// Compatibilidade: código antigo chamava empresaPiloto() esperando "a" empresa.
// Continua funcionando com uma empresa só; com várias, use as funções acima.
export async function empresaPiloto() {
  const { data } = await db.from("empresas").select(CAMPOS_EMPRESA).order("criado_em").limit(1).maybeSingle();
  return data || null;
}

// O catálogo fica no banco, por empresa. Enquanto a empresa não tiver o dela
// preenchido, cai no arquivo antigo (que é placeholder e precisa ser trocado).
export function catalogoDe(empresa) {
  return (empresa && empresa.catalogo) || catalogoPadrao;
}

// Quem recebe alertas e resumo: o dono daquela empresa, não um número global.
export function donoDe(empresa) {
  return (empresa && empresa.dono_whatsapp) || process.env.DONO_WHATSAPP || null;
}

// Credenciais de anúncio ficam fora de CAMPOS_EMPRESA de propósito: aquela lista
// é carregada em toda requisição do painel e do webhook, e estes tokens só
// precisam existir dentro do agente de marketing.
export async function credenciaisAnuncios(empresa_id) {
  const { data } = await db.from("empresas")
    .select("google_ads_customer_id, google_ads_refresh_token, meta_ad_account_id, meta_ads_token, marketing_config")
    .eq("id", empresa_id).maybeSingle();
  return data || null;
}

// ---------- autenticação do painel ----------
// A senha do .env é a chave mestra (EJ Digital) e enxerga todas as empresas.
// Cada empresa pode ter a própria senha e enxerga só a si mesma.
export async function empresasDaSenha(senha) {
  if (!senha) return [];
  if (senha === process.env.PAINEL_SENHA) return await listarEmpresas();
  const { data } = await db.from("empresas").select(CAMPOS_EMPRESA).eq("senha_painel", senha);
  return (data || []).filter((e) => e.ativa !== false);
}

// Resolve a empresa de uma requisição do painel: confere a senha e, se veio um
// empresa_id, garante que a senha realmente dá acesso àquela empresa.
export async function empresaDaRequisicao(req, empresa_id) {
  const senha = req.headers.get("x-senha");
  const permitidas = await empresasDaSenha(senha);
  if (!permitidas.length) return { erro: "não autorizado", status: 401 };
  if (empresa_id) {
    const escolhida = permitidas.find((e) => e.id === empresa_id);
    if (!escolhida) return { erro: "empresa não encontrada", status: 404 };
    return { empresa: escolhida, permitidas };
  }
  return { empresa: permitidas[0], permitidas };
}

export async function registrarEvento(empresa_id, tipo, detalhe) {
  await db.from("eventos").insert({ empresa_id, tipo, detalhe });
}

// Busca ou cria cliente + conversa aberta para um telefone
export async function obterConversa(empresa_id, telefone, nome) {
  let { data: cliente } = await db.from("clientes").select("*").eq("empresa_id", empresa_id).eq("telefone", telefone).maybeSingle();
  if (!cliente) {
    ({ data: cliente } = await db.from("clientes").insert({ empresa_id, telefone, nome, origem: "WhatsApp" }).select().single());
  }
  let { data: conversa } = await db.from("conversas").select("*").eq("cliente_id", cliente.id).order("atualizado_em", { ascending: false }).limit(1).maybeSingle();
  if (!conversa) {
    ({ data: conversa } = await db.from("conversas").insert({ empresa_id, cliente_id: cliente.id }).select().single());
  }
  return { cliente, conversa };
}

export async function salvarMensagem(conversa_id, autor, texto, wa_message_id) {
  await db.from("mensagens").insert({ conversa_id, autor, texto, wa_message_id });
  await db.from("conversas").update({ atualizado_em: new Date().toISOString() }).eq("id", conversa_id);
}

export async function historico(conversa_id, limite = 20) {
  const { data } = await db.from("mensagens").select("autor, texto").eq("conversa_id", conversa_id).order("criado_em", { ascending: false }).limit(limite);
  return (data || []).reverse();
}
