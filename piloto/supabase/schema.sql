-- Rode este arquivo no SQL Editor do Supabase (uma vez).
create extension if not exists pgcrypto;

create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz default now()
);

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

create table if not exists eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id),
  tipo text not null,                           -- mensagem_recebida | resposta_ia | escalado | agendamento | cobranca_enviada | erro
  detalhe jsonb,
  criado_em timestamptz default now()
);

-- Empresa piloto (troque o nome)
insert into empresas (nome) values ('Empresa Piloto') on conflict do nothing;
