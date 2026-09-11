import { createClient } from "@supabase/supabase-js";

let _db;
function getDb() {
  if (!_db) _db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return _db;
}
// Cliente criado só na primeira chamada (evita erro no build sem variáveis de ambiente)
export const db = { from: (t) => getDb().from(t) };

export async function empresaPiloto() {
  const { data } = await db.from("empresas").select("id, nome").limit(1).single();
  return data;
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
