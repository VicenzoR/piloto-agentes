import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { empresaDaRequisicao, listarEmpresas, registrarEvento } from "@/lib/db";
import { montarResumoMarketing, prepararEAvisar } from "@/lib/marketing";

// Quantas empresas são lidas ao mesmo tempo. Em sequência estoura o tempo da
// função; todas juntas esbarram no limite de requisições das APIs de anúncio.
const LOTE = 3;

// GET: cron semanal da Vercel (Authorization: Bearer CRON_SECRET).
// Percorre todas as empresas ativas; quem não tem anúncio configurado é ignorado.
export async function GET(req) {
  const bearer = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  const painel = req.headers.get("x-senha") === process.env.PAINEL_SENHA;
  if (!bearer && !painel) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });

  const empresas = await listarEmpresas();
  const resultados = [];
  for (let i = 0; i < empresas.length; i += LOTE) {
    const lote = empresas.slice(i, i + LOTE);
    const feitos = await Promise.all(lote.map(async (emp) => {
      try {
        return { empresa: emp.nome, ...(await prepararEAvisar(emp)) };
      } catch (e) {
        // Uma empresa com problema não pode impedir o resumo das outras.
        await registrarEvento(emp.id, "erro", { marketing: String(e) }).catch(() => {});
        return { empresa: emp.nome, enviado: false, erro: String(e) };
      }
    }));
    resultados.push(...feitos.filter((r) => !r.ignorada));
  }
  return NextResponse.json({ empresas: resultados.length, resultados });
}

// POST: prévia no painel. Só monta o texto; não guarda nem manda nada no WhatsApp.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { empresa, erro, status } = await empresaDaRequisicao(req, body.empresa_id);
  if (erro) return NextResponse.json({ erro }, { status });
  const resumo = await montarResumoMarketing(empresa);
  if (!resumo) return NextResponse.json({ erro: "empresa sem conta de anúncio configurada" });
  return NextResponse.json(resumo);
}
