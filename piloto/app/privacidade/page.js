export const metadata = { title: "Política de Privacidade" };

const S = {
  wrap: { maxWidth: 760, margin: "0 auto", padding: "40px 20px", lineHeight: 1.6 },
  h1: { fontSize: 28, marginBottom: 4 },
  sub: { color: "#666", fontSize: 14, marginTop: 0 },
  h2: { fontSize: 18, marginTop: 32, marginBottom: 8 },
  p: { margin: "8px 0" },
};

export default function Privacidade() {
  return (
    <main style={S.wrap}>
      <h1 style={S.h1}>Política de Privacidade</h1>
      <p style={S.sub}>Última atualização: setembro de 2026</p>

      <p style={S.p}>
        Esta política descreve como tratamos dados pessoais na plataforma de atendimento e cobrança
        automatizados por inteligência artificial, disponibilizada a empresas para uso no WhatsApp.
      </p>

      <h2 style={S.h2}>1. Quem trata os dados</h2>
      <p style={S.p}>
        A empresa contratante do serviço é a controladora dos dados dos seus próprios clientes. Atuamos
        como operadores, tratando esses dados exclusivamente conforme as instruções da contratante e
        para a finalidade de prestação do serviço.
      </p>

      <h2 style={S.h2}>2. Dados tratados</h2>
      <p style={S.p}>
        Número de telefone, nome do perfil do WhatsApp, conteúdo das mensagens trocadas com a empresa,
        pedidos de agendamento e informações de cobrança fornecidas pela empresa contratante, como nome,
        valor e data de vencimento.
      </p>

      <h2 style={S.h2}>3. Finalidade</h2>
      <p style={S.p}>
        Responder a solicitações de atendimento, registrar pedidos de agendamento, encaminhar
        conversas a atendentes humanos quando necessário e enviar lembretes de pagamento autorizados
        pela empresa contratante.
      </p>

      <h2 style={S.h2}>4. Atendimento automatizado</h2>
      <p style={S.p}>
        Parte das respostas é gerada por inteligência artificial. O usuário é informado disso no início
        do atendimento e pode, a qualquer momento, pedir para falar com um atendente humano.
      </p>

      <h2 style={S.h2}>5. Compartilhamento</h2>
      <p style={S.p}>
        Utilizamos fornecedores para viabilizar o serviço: Meta Platforms (WhatsApp Business Platform),
        Anthropic (geração de respostas por inteligência artificial), Supabase (banco de dados) e Vercel
        (hospedagem). Parte do tratamento ocorre fora do Brasil. Não vendemos nem cedemos dados pessoais
        a terceiros para fins de publicidade.
      </p>

      <h2 style={S.h2}>6. Mensagens e descadastro</h2>
      <p style={S.p}>
        Mensagens enviadas por iniciativa da empresa só ocorrem mediante autorização. Para deixar de
        recebê-las, basta responder SAIR na conversa do WhatsApp.
      </p>

      <h2 style={S.h2}>7. Retenção e segurança</h2>
      <p style={S.p}>
        As conversas e registros são mantidos enquanto durar o contrato com a empresa contratante e pelo
        prazo necessário ao cumprimento de obrigações legais. O acesso é restrito, protegido por
        autenticação, e os dados trafegam de forma criptografada.
      </p>

      <h2 style={S.h2}>8. Direitos do titular</h2>
      <p style={S.p}>
        Nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018), o titular pode solicitar
        confirmação de tratamento, acesso, correção, anonimização, portabilidade e exclusão dos seus
        dados, além de revogar consentimento. Os pedidos são encaminhados à empresa contratante, na
        qualidade de controladora, e atendidos nos prazos legais.
      </p>

      <h2 style={S.h2}>9. Contato</h2>
      <p style={S.p}>
        Para exercer seus direitos ou esclarecer dúvidas sobre esta política, entre em contato pelo
        e-mail informado pela empresa contratante no início do atendimento.
      </p>
    </main>
  );
}
