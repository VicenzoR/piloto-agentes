const API = "https://graph.facebook.com/v21.0";

// Todo envio passa pelo número da empresa dona da conversa. O phone_number_id e
// o token saem da tabela empresas; as variáveis de ambiente ficam só como
// reserva para a empresa que ainda não foi preenchida.
function credenciais(empresa) {
  const phone = empresa?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = empresa?.whatsapp_token || process.env.WHATSAPP_TOKEN;
  if (!phone || !token) throw new Error("WhatsApp: empresa sem phone_number_id ou token configurado");
  return { phone, token };
}

// Telefone como a Meta espera: só dígitos, com o 55 na frente.
// Linha de planilha vem com parêntese, traço e às vezes sem o DDI.
export function normalizarTelefone(numero) {
  let d = String(numero || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 11) d = "55" + d;          // faltou o código do país
  return d;
}

export async function enviarTexto(empresa, para, texto) {
  const { phone, token } = credenciais(empresa);
  const destino = normalizarTelefone(para);
  if (destino === String(phone) || !destino) throw new Error("WhatsApp: destino inválido");
  const r = await fetch(`${API}/${phone}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: destino, type: "text", text: { body: texto } }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("WhatsApp: " + JSON.stringify(j));
  return j.messages?.[0]?.id;
}

// Template aprovado na Meta (necessário para mensagens fora da janela de 24h, como cobrança).
// A aprovação é POR CONTA: cada empresa precisa ter o template criado na WABA dela,
// com o mesmo nome e a mesma quantidade de variáveis usada aqui.
export async function enviarTemplate(empresa, para, nome, parametros) {
  const { phone, token } = credenciais(empresa);
  const destino = normalizarTelefone(para);
  if (!destino) throw new Error("WhatsApp template: telefone vazio");
  // A Meta recusa o número mandando para ele mesmo, e o erro que volta é o
  // genérico "(#100) Invalid parameter", que não diz o motivo.
  if (destino === String(phone)) throw new Error("WhatsApp template: destino é o próprio número da empresa");
  const r = await fetch(`${API}/${phone}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: destino, type: "template",
      template: { name: nome, language: { code: "pt_BR" }, components: [{ type: "body", parameters: parametros.map((t) => ({ type: "text", text: String(t) })) }] },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("WhatsApp template: " + JSON.stringify(j));
  return j.messages?.[0]?.id;
}
