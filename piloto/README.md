# Piloto: Agente de Atendimento e Cobrança no WhatsApp

O que este projeto faz:
- Recebe mensagens do WhatsApp da empresa, responde com IA usando SOMENTE o catálogo em `config/empresa.json`.
- Registra pedidos de agendamento e avisa o dono no WhatsApp.
- Passa a conversa para um humano quando não sabe, quando pedem desconto ou quando o cliente reclama.
- Painel web simples para ver conversas, assumir e responder.
- Rota de cobrança que envia lembrete (template aprovado) para contas vencidas, em horário comercial, no máximo 1 vez por semana por conta.

## Passo a passo (1 dia)

### 1. Supabase (banco)
1. Crie um projeto em https://supabase.com (gratuito).
2. Abra SQL Editor, cole o conteúdo de `supabase/schema.sql` e rode.
3. Em Table Editor > `empresas`, troque o nome "Empresa Piloto" pelo nome real.
4. Em Project Settings > API, copie a URL e a chave `service_role`.

### 2. Anthropic
1. Crie uma chave em https://console.anthropic.com e coloque crédito.

### 3. WhatsApp (Meta)
1. https://developers.facebook.com > Meus Apps > Criar app > tipo "Business".
2. Adicione o produto WhatsApp. Na aba "API Setup" você recebe um NÚMERO DE TESTE gratuito e um token temporário. Ele já funciona hoje para até 5 números cadastrados (use o seu e o do dono para testar).
3. Copie `Phone number ID` e o token para o `.env`.
4. Para usar o número real da empresa: Business Manager > verificação da empresa (leva alguns dias) e adicionar o número. Faça isso em paralelo, no dia 1.
5. Template de cobrança: WhatsApp Manager > Message templates > criar `lembrete_vencimento`, categoria Utility, idioma pt_BR, corpo:
   `Olá {{1}}, aqui é a {{2}}. Identificamos um pagamento de R$ {{3}} com vencimento em {{4}} em aberto. Se já pagou, desconsidere. Podemos ajudar? Responda SAIR para não receber mais avisos.`

### 4. Catálogo
Edite `config/empresa.json` com serviços, preços, horários, endereço e políticas reais. A IA só responde o que estiver aqui.

### 5. Deploy (Vercel)
1. Suba este projeto no GitHub.
2. https://vercel.com > New Project > importe o repositório.
3. Em Environment Variables, cadastre todas as variáveis de `.env.example` com os valores reais.
4. Deploy. Sua URL será algo como `https://seu-projeto.vercel.app`.

### 6. Ligar o webhook
1. No app da Meta > WhatsApp > Configuration > Webhook: Callback URL = `https://seu-projeto.vercel.app/api/whatsapp/webhook`, Verify token = o mesmo de `WHATSAPP_VERIFY_TOKEN`.
2. Assine o campo `messages`.
3. Mande "oi" para o número. A IA deve responder em segundos.

### 7. Painel
Abra `https://seu-projeto.vercel.app`, entre com `PAINEL_SENHA`.

### 8. Cobrança
1. Cadastre as contas vencidas na tabela `contas_receber` (pode importar CSV pelo Table Editor do Supabase; telefone com DDI, ex.: 5527999999999; vencimento AAAA-MM-DD).
2. Para disparar (em horário comercial):
   `curl -X POST https://seu-projeto.vercel.app/api/cobranca -H "Content-Type: application/json" -d '{"senha":"SUA_SENHA","dias_min":3}'`
3. Quando o cliente pagar, mude `status` para `pago`.

## Rodar local
```
cp .env.example .env
npm install
npm run dev
```
Para o webhook chegar na sua máquina, use `npx ngrok http 3000` e cadastre a URL do ngrok na Meta.

## Regras de segurança já embutidas
- Preços e condições só do catálogo; fora disso, chama a equipe.
- Desconto, reclamação e cliente irritado sempre vão para humano.
- Cobrança: template neutro, horário comercial, 1 vez por semana, "SAIR" desativa.
- Toda mensagem, resposta, escalação e erro fica em `eventos` (auditoria).
- Se a IA falhar, o dono recebe aviso no WhatsApp.

## Próximos passos depois do piloto
- Login real (Supabase Auth) e multiempresa (a estrutura já tem `empresa_id` em tudo).
- Reativação de clientes antigos (template + regra de 60/90 dias).
- Link de pagamento na conversa.
- Substituir o painel simples pela interface completa (`CentralDeComando.jsx`).
