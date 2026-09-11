const API = "https://graph.facebook.com/v21.0";

export async function enviarTexto(para, texto) {
  const r = await fetch(`${API}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: para, type: "text", text: { body: texto } }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("WhatsApp: " + JSON.stringify(j));
  return j.messages?.[0]?.id;
}

// Template aprovado na Meta (necessário para mensagens fora da janela de 24h, como cobrança).
// Crie o template "lembrete_vencimento" com o corpo:
// "Olá {{1}}, aqui é a {{2}}. Identificamos um pagamento de R$ {{3}} com vencimento em {{4}} em aberto. Se já pagou, desconsidere. Podemos ajudar? Responda SAIR para não receber mais avisos."
export async function enviarTemplate(para, nome, parametros) {
  const r = await fetch(`${API}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: para, type: "template",
      template: { name: nome, language: { code: "pt_BR" }, components: [{ type: "body", parameters: parametros.map((t) => ({ type: "text", text: String(t) })) }] },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("WhatsApp template: " + JSON.stringify(j));
  return j.messages?.[0]?.id;
}
