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

### 9. Marketing (resumo semanal de anúncios)
Toda segunda às 8h o dono recebe um aviso no WhatsApp; quando responde, recebe o resumo da semana anterior (gasto, comparação, resultado por campanha, o que olhar). Só leitura: o sistema nunca cria, pausa ou altera campanha.

1. Template de aviso: WhatsApp Manager > Message templates > criar `resumo_anuncios_pronto`, categoria Utility, idioma pt_BR, corpo:
   `O resumo semanal dos anúncios da {{1}}, referente a {{2}}, está pronto. Responda esta mensagem para receber aqui.`
   Botão de resposta rápida: `Ver resumo`. Exemplos para a Meta: {{1}} = `Eco+ Gestão de Resíduos`, {{2}} = `21/09 a 27/09`.
2. Rode de novo `supabase/schema.sql` (cria as colunas de anúncio e a tabela `resumos_marketing`).
3. Google Ads (uma vez, da agência): projeto OAuth no Google Cloud publicado em produção (em "Teste" o refresh token expira em 7 dias) e developer token com acesso Basic. Cadastre `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID` e `GOOGLE_ADS_CLIENT_SECRET` na Vercel.
4. Google Ads (cada cliente): em Ferramentas > Acesso e segurança, o cliente convida o e-mail Google da agência com acesso **Somente leitura**. Na tabela `empresas`, preencha `google_ads_customer_id` (10 dígitos) e `google_ads_refresh_token` (gerado autorizando com o usuário da agência).
5. Meta Ads (cada cliente): o cliente dá ao nosso Business acesso de parceiro à conta de anúncios só para ver desempenho, ou cria um usuário do sistema com essa permissão e gera um token só com `ads_read`. Preencha `meta_ad_account_id` e `meta_ads_token`.
6. Opcional, em `marketing_config`: `{"resultado_meta": ["lead"], "gasto_minimo_alerta": 100, "resultados_minimos": 3, "resultado_singular": "lead", "resultado_plural": "leads"}`.
7. Confira no painel, aba Marketing > Gerar prévia.

Empresa sem essas colunas preenchidas é ignorada.

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
