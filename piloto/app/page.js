"use client";
import { useEffect, useState } from "react";

const S = {
  wrap: { maxWidth: 1100, margin: "0 auto", padding: 20 },
  card: { background: "#fff", border: "1px solid #dde1e6", borderRadius: 8, padding: 16, marginBottom: 16 },
  btn: { background: "#0f7b6c", color: "#fff", border: 0, borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 14 },
  btn2: { background: "#fff", color: "#333", border: "1px solid #bbb", borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 14 },
  input: { border: "1px solid #bbb", borderRadius: 6, padding: 8, fontSize: 14, width: "100%", boxSizing: "border-box" },
  tag: (c) => ({ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: c === "ia" ? "#e6f4f1" : "#fff3e0", color: c === "ia" ? "#0f7b6c" : "#a15c00" }),
};

export default function Painel() {
  const [senha, setSenha] = useState("");
  const [ok, setOk] = useState(false);
  const [dados, setDados] = useState(null);
  const [sel, setSel] = useState(null);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState("conversas");
  const [contas, setContas] = useState(null);
  const [colagem, setColagem] = useState("");
  const [aviso, setAviso] = useState("");
  const [resumo, setResumo] = useState("");
  const [empresaId, setEmpresaId] = useState("");   // empresa selecionada no topo

  const carregar = async (s = senha, emp = empresaId) => {
    const q = emp ? `?empresa_id=${emp}` : "";
    const r = await fetch("/api/conversas" + q, { headers: { "x-senha": s } });
    if (!r.ok) { setErro("Senha incorreta."); return; }
    const d = await r.json();
    setDados(d); setOk(true); setErro("");
    if (!emp && d.empresa_id) setEmpresaId(d.empresa_id);
  };
  useEffect(() => { if (ok) { const t = setInterval(() => carregar(), 10000); return () => clearInterval(t); } }, [ok, empresaId]);
  // Troca de empresa recarrega tudo: conversas, contas e resumo são por empresa.
  useEffect(() => { if (ok && empresaId) { carregar(); setContas(null); setResumo(""); } }, [empresaId]);

  const carregarContas = async () => {
    const r = await fetch("/api/contas?empresa_id=" + empresaId, { headers: { "x-senha": senha } });
    if (r.ok) setContas(await r.json());
  };
  useEffect(() => { if (ok && aba === "contas") carregarContas(); }, [ok, aba]);

  // Aceita linhas coladas da planilha: nome; telefone; valor; vencimento
  const salvarContas = async () => {
    const linhas = colagem.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const p = l.split(/[\t;]/).map((x) => x.trim());
      return { cliente_nome: p[0], telefone: p[1], valor: p[2], vencimento: p[3] };
    });
    if (!linhas.length) return;
    const r = await fetch("/api/contas", { method: "POST", headers: { "Content-Type": "application/json", "x-senha": senha }, body: JSON.stringify({ linhas, empresa_id: empresaId }) });
    const d = await r.json();
    setAviso(`${d.inseridas} cadastrada(s).` + (d.erros?.length ? " Problemas: " + d.erros.join("; ") : ""));
    setColagem(""); carregarContas();
  };

  const mudarConta = async (id, acao) => {
    await fetch("/api/contas", { method: "PATCH", headers: { "Content-Type": "application/json", "x-senha": senha }, body: JSON.stringify({ id, acao, empresa_id: empresaId }) });
    carregarContas();
  };

  const dispararCobranca = async () => {
    if (!confirm("Enviar lembrete de cobrança para os vencidos? As mensagens são pré-aprovadas e vão em horário comercial.")) return;
    const r = await fetch("/api/cobranca", { method: "POST", headers: { "Content-Type": "application/json", "x-senha": senha }, body: JSON.stringify({ dias_min: 3, empresa_id: empresaId }) });
    const d = await r.json();
    setAviso(d.erro ? "Não enviou: " + d.erro : `${d.enviadas} lembrete(s) enviado(s).`);
    carregarContas();
  };

  const gerarResumo = async (enviarNoZap) => {
    setResumo("Gerando...");
    const r = await fetch("/api/gestor", { method: "POST", headers: { "Content-Type": "application/json", "x-senha": senha }, body: JSON.stringify({ enviar: enviarNoZap, empresa_id: empresaId }) });
    const d = await r.json();
    setResumo(d.texto || d.erro || "Não consegui gerar.");
    if (enviarNoZap) setAviso(d.enviado ? "Resumo enviado no WhatsApp do dono." : "Não enviou: " + (d.erro || "erro desconhecido"));
  };

  const enviar = async (body) => {
    await fetch("/api/enviar", { method: "POST", headers: { "Content-Type": "application/json", "x-senha": senha }, body: JSON.stringify({ conversa_id: sel, empresa_id: empresaId, ...body }) });
    setTexto(""); carregar();
  };

  if (!ok) return (
    <div style={{ ...S.wrap, maxWidth: 360, paddingTop: 80 }}>
      <div style={S.card}>
        <h2 style={{ marginTop: 0 }}>Painel do piloto</h2>
        <input style={S.input} type="password" placeholder="Senha" value={senha} onChange={(e) => setSenha(e.target.value)} onKeyDown={(e) => e.key === "Enter" && carregar()} />
        {erro && <p style={{ color: "#b00020", fontSize: 13 }}>{erro}</p>}
        <button style={{ ...S.btn, marginTop: 10, width: "100%" }} onClick={() => carregar()}>Entrar</button>
      </div>
    </div>
  );

  const conv = dados.conversas.find((c) => c.id === sel);
  const escaladas = dados.conversas.filter((c) => c.atendido_por === "humano").length;

  return (
    <div style={S.wrap}>
      {(dados.empresas || []).length > 1 ? (
        <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}
          style={{ ...S.input, width: "auto", fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
          {dados.empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      ) : (
        <h1 style={{ fontSize: 22 }}>{dados.empresa}</h1>
      )}
      <p style={{ color: "#666", fontSize: 14 }}>{dados.conversas.length} conversas · {escaladas} aguardando a equipe · {dados.agendamentos.length} pedidos de agendamento</p>

      <div style={{ display: "flex", gap: 8, margin: "12px 0 16px" }}>
        {[["conversas", "Atendimento"], ["contas", "Cobrança"], ["gestor", "Gestor"]].map(([id, label]) => (
          <button key={id} onClick={() => setAba(id)} style={{ ...S.btn2, background: aba === id ? "#0f7b6c" : "#fff", color: aba === id ? "#fff" : "#333", borderColor: aba === id ? "#0f7b6c" : "#bbb" }}>{label}</button>
        ))}
      </div>
      {aviso && <div style={{ ...S.card, background: "#eef7f5", fontSize: 14 }}>{aviso}</div>}

      {aba === "contas" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            {[["Em aberto", contas ? `R$ ${contas.resumo.total_aberto.toLocaleString("pt-BR")}` : "-"],
              ["Vencido", contas ? `R$ ${contas.resumo.total_vencido.toLocaleString("pt-BR")}` : "-"],
              ["Clientes em atraso", contas ? contas.resumo.qtd_vencida : "-"],
              ["Atraso médio", contas ? contas.resumo.media_atraso + " dias" : "-"]].map(([l, v]) => (
              <div key={l} style={{ ...S.card, marginBottom: 0 }}>
                <div style={{ fontSize: 12, color: "#666" }}>{l}</div>
                <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={S.card}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>Cadastrar contas a receber</h3>
            <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
              Cole uma linha por cliente, separando com ponto e vírgula ou colando direto da planilha:<br />
              <code>Nome; 5527999999999; 450,00; 05/09/2026</code>
            </p>
            <textarea value={colagem} onChange={(e) => setColagem(e.target.value)} rows={5}
              placeholder={"Joao Silva; 5527999999999; 450,00; 05/09/2026\nMaria Souza; 5527988887777; 1200,00; 12/09/2026"}
              style={{ ...S.input, fontFamily: "monospace", fontSize: 13 }} />
            <button style={{ ...S.btn, marginTop: 10 }} onClick={salvarContas}>Cadastrar</button>
          </div>

          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>Contas</h3>
              <button style={S.btn} onClick={dispararCobranca}>Cobrar vencidos</button>
            </div>
            {!contas || contas.contas.length === 0
              ? <p style={{ fontSize: 13, color: "#666" }}>Nenhuma conta cadastrada ainda.</p>
              : (
                <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse", marginTop: 10 }}>
                  <thead><tr style={{ textAlign: "left", color: "#666", fontSize: 12 }}>
                    <th style={{ paddingBottom: 6 }}>Cliente</th><th>Telefone</th><th>Valor</th><th>Vence</th><th>Situação</th><th>Última cobrança</th><th></th>
                  </tr></thead>
                  <tbody>
                    {contas.contas.map((c) => (
                      <tr key={c.id} style={{ borderTop: "1px solid #eee" }}>
                        <td style={{ padding: "6px 0" }}>{c.cliente_nome}</td>
                        <td>{c.telefone}</td>
                        <td>R$ {Number(c.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                        <td>{c.vencimento.split("-").reverse().join("/")}</td>
                        <td>{c.status === "pago" ? <span style={{ color: "#0f7b6c" }}>pago</span>
                          : c.dias_atraso > 0 ? <span style={{ color: "#b00020" }}>{c.dias_atraso} dias em atraso</span>
                          : <span style={{ color: "#666" }}>a vencer</span>}</td>
                        <td style={{ color: "#666", fontSize: 12 }}>{c.ultima_cobranca ? new Date(c.ultima_cobranca).toLocaleDateString("pt-BR") : "-"}</td>
                        <td style={{ textAlign: "right" }}>
                          <button style={{ ...S.btn2, padding: "4px 8px", fontSize: 12, marginRight: 6 }}
                            onClick={() => mudarConta(c.id, c.status === "pago" ? "aberto" : "pago")}>
                            {c.status === "pago" ? "Reabrir" : "Marcar pago"}
                          </button>
                          <button style={{ ...S.btn2, padding: "4px 8px", fontSize: 12 }} onClick={() => mudarConta(c.id, "apagar")}>Apagar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </div>
      )}

      {aba === "gestor" && (
        <div style={S.card}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Resumo do dia</h3>
          <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
            É o que o dono recebe todo dia às 7h no WhatsApp. Gere aqui para conferir antes de enviar.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.btn2} onClick={() => gerarResumo(false)}>Gerar prévia</button>
            <button style={S.btn} onClick={() => gerarResumo(true)}>Enviar no WhatsApp</button>
          </div>
          {resumo && (
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, background: "#f7f8f9", border: "1px solid #e3e6ea", borderRadius: 6, padding: 12, marginTop: 12 }}>{resumo}</pre>
          )}
        </div>
      )}

      {aba === "conversas" && (

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
        <div>
          <div style={S.card}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>Conversas</h3>
            {dados.conversas.length === 0 && <p style={{ fontSize: 13, color: "#666" }}>Nenhuma conversa ainda. Mande um WhatsApp para o número da empresa.</p>}
            {dados.conversas.map((c) => (
              <div key={c.id} onClick={() => setSel(c.id)} style={{ padding: 10, borderRadius: 6, cursor: "pointer", background: sel === c.id ? "#eef7f5" : "transparent", borderBottom: "1px solid #eee" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                  <b>{c.clientes?.nome || c.clientes?.telefone}</b>
                  <span style={S.tag(c.atendido_por)}>{c.atendido_por === "ia" ? "IA" : "Equipe"}</span>
                </div>
                <div style={{ fontSize: 12, color: "#666" }}>{c.estagio}{c.motivo_escalacao ? " · " + c.motivo_escalacao : ""}</div>
              </div>
            ))}
          </div>
          <div style={S.card}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>Pedidos de agendamento</h3>
            {dados.agendamentos.length === 0 && <p style={{ fontSize: 13, color: "#666" }}>Nenhum ainda.</p>}
            {dados.agendamentos.map((a, i) => <div key={i} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid #eee" }}><b>{a.clientes?.nome || a.clientes?.telefone}</b> · {a.servico} · {a.data_hora} · {a.status}</div>)}
          </div>
        </div>

        <div style={S.card}>
          {!conv ? <p style={{ color: "#666", fontSize: 14 }}>Selecione uma conversa.</p> : (<>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>{conv.clientes?.nome || conv.clientes?.telefone} <span style={{ color: "#888", fontWeight: 400 }}>· {conv.clientes?.telefone}</span></h3>
              {conv.atendido_por === "ia"
                ? <button style={S.btn2} onClick={() => enviar({})}>Assumir conversa</button>
                : <button style={S.btn2} onClick={() => enviar({ devolver_para_ia: true })}>Devolver para a IA</button>}
            </div>
            <div style={{ maxHeight: 420, overflowY: "auto", margin: "12px 0", display: "flex", flexDirection: "column", gap: 6 }}>
              {[...conv.mensagens].sort((a, b) => a.criado_em.localeCompare(b.criado_em)).map((m, i) => (
                <div key={i} style={{ alignSelf: m.autor === "cliente" ? "flex-start" : "flex-end", maxWidth: "75%", fontSize: 14, padding: "8px 12px", borderRadius: 8,
                  background: m.autor === "cliente" ? "#f0f0f0" : m.autor === "ia" ? "#e6f4f1" : m.autor === "sistema" ? "#fff3e0" : "#e3f0fb" }}>
                  <div style={{ fontSize: 11, color: "#777" }}>{{ cliente: "Cliente", ia: "IA", humano: "Você", sistema: "Sistema" }[m.autor]}</div>{m.texto}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={S.input} placeholder="Escreva uma mensagem (assume a conversa)" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && texto && enviar({ texto })} />
              <button style={S.btn} onClick={() => texto && enviar({ texto })}>Enviar</button>
            </div>
          </>)}
        </div>
      </div>
      )}
    </div>
  );
}
