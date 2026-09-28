-- Rode este arquivo no SQL Editor do Supabase (uma vez).
create extension if not exists pgcrypto;

create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz default now()
);

-- Configuração por empresa (multiempresa). Em "alter" para também atualizar
-- bancos criados com a versão antiga deste arquivo.
alter table empresas add column if not exists slug text;
alter table empresas add column if not exists phone_number_id text;   -- número do WhatsApp que recebe as mensagens
alter table empresas add column if not exists whatsapp_token text;
alter table empresas add column if not exists dono_whatsapp text;     -- quem recebe alertas e o resumo do dia
alter table empresas add column if not exists senha_painel text;      -- senha do painel que enxerga só esta empresa
alter table empresas add column if not exists teto_mensagens integer; -- vazio = TETO_MENSAGENS_MES
alter table empresas add column if not exists catalogo jsonb;         -- vazio = config/empresa.json
alter table empresas add column if not exists ativa boolean default true;
create unique index if not exists empresas_phone on empresas (phone_number_id) where phone_number_id is not null;
create unique index if not exists empresas_slug on empresas (slug) where slug is not null;

-- Anúncios (agente de marketing). Só leitura: no Google, o usuário da agência é
-- convidado com acesso "Somente leitura"; no Meta, o token tem só ads_read.
alter table empresas add column if not exists google_ads_customer_id text;   -- 10 dígitos, sem traço
alter table empresas add column if not exists google_ads_refresh_token text;
alter table empresas add column if not exists meta_ad_account_id text;       -- sem o prefixo act_
alter table empresas add column if not exists meta_ads_token text;
alter table empresas add column if not exists marketing_config jsonb;        -- limites e o que conta como resultado; vazio = padrão do código

create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) not null,
  telefone text not null,
  nome text,
  origem text,
  criado_em timestamptz default now(),
  unique (empresa_id, telefone)
);

create table if not exists conversas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) not null,
  cliente_id uuid references clientes(id) not null,
  estagio text default 'Novo lead',            -- Novo lead | Em atendimento | Orçamento | Negociação | Venda | Perdido
  atendido_por text default 'ia',              -- ia | humano
  motivo_escalacao text,
  atualizado_em timestamptz default now()
);

create table if not exists mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid references conversas(id) not null,
  autor text not null,                          -- cliente | ia | humano | sistema
  texto text not null,
  wa_message_id text,
  criado_em timestamptz default now()
);

create table if not exists agendamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) not null,
  cliente_id uuid references clientes(id) not null,
  servico text not null,
  data_hora text not null,                      -- texto livre no piloto ("sábado 10h"); vira timestamp depois
  status text default 'solicitado',            -- solicitado | confirmado | cancelado
  criado_em timestamptz default now()
);

create table if not exists contas_receber (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) not null,
  cliente_nome text not null,
  telefone text not null,
  valor numeric not null,
  vencimento date not null,
  status text default 'aberto',                -- aberto | pago
  ultima_cobranca timestamptz
);

alter table contas_receber add column if not exists ultimo_aviso timestamptz;  -- aviso antes do vencimento

create table if not exists contratos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) not null,
  cliente_nome text not null,
  servico text,
  valor_mensal numeric,
  renovacao date,
  status text default 'ativo',                  -- ativo | encerrado
  criado_em timestamptz default now()
);

create table if not exists documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) not null,
  cliente_id uuid references clientes(id),
  cliente_nome text,
  tipo text not null,                           -- MTR | CDF | Certificado de destinação | Laudo de caracterização
  competencia text,                             -- MM/AAAA
  status text default 'pendente',               -- pendente | disponivel | entregue
  link text,
  criado_em timestamptz default now()
);

create table if not exists eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id),
  tipo text not null,                           -- mensagem_recebida | resposta_ia | escalado | agendamento | cobranca_enviada | erro
  detalhe jsonb,
  criado_em timestamptz default now()
);

-- Resumo semanal de anúncios esperando o dono responder ao template de aviso.
-- Existe por causa da janela de 24h do WhatsApp: o texto completo só pode sair
-- depois que o dono escreve.
create table if not exists resumos_marketing (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) not null,
  periodo text not null,                        -- "21/09 a 27/09"
  texto text not null,
  status text default 'pendente',               -- pendente | enviando | enviado | expirado | falhou
  resposta_wa_id text,                          -- mensagem do dono que disparou a entrega
  criado_em timestamptz default now(),
  enviado_em timestamptz
);

-- Empresa piloto (troque o nome)
insert into empresas (nome) values ('Empresa Piloto') on conflict do nothing;
