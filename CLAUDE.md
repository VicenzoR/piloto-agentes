# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

WhatsApp customer-service and debt-collection agent (pilot) for small Brazilian businesses. The whole app lives in `piloto/` (Next.js 15 App Router, React 19, plain JavaScript, no TypeScript). Backed by Supabase (Postgres), the WhatsApp Cloud API (Meta Graph v21.0) and the Anthropic SDK. Deployed on Vercel. Code, comments, identifiers, DB columns and user-facing text are all in Portuguese — keep it that way.

## Commands

Run from `piloto/`:

```
npm install
npm run dev      # local server on :3000
npm run build    # production build (also the only "check" available)
```

There is no test suite, linter or formatter configured. To receive webhooks locally, expose the dev server (`npx ngrok http 3000`) and register that URL in the Meta app. The README references `.env.example`, but it is not in the repo.

Environment variables used: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_TOKEN` / `DONO_WHATSAPP` (fallbacks only), `PAINEL_SENHA` (master panel password), `CRON_SECRET`, `TETO_MENSAGENS_MES`.

## Architecture

**Multi-tenant by `empresa`.** Every per-company setting lives in the `empresas` row: `phone_number_id`, `whatsapp_token`, `dono_whatsapp`, `senha_painel`, `teto_mensagens`, `catalogo` (JSON), `ativa`. Env vars and `config/empresa.json` are only fallbacks for a company not yet filled in (`catalogoDe`, `donoDe`, `credenciais` in `lib/`). `config/empresa.json` is explicitly placeholder data. Never add new per-company config as a global env var or file; always scope queries with `empresa_id`.

**Inbound flow — `app/api/whatsapp/webhook/route.js`:**
1. Validates Meta's `x-hub-signature-256` HMAC over the *raw* body (`META_APP_SECRET`). Rejects when the secret is missing.
2. Resolves the company from `metadata.phone_number_id` (`empresaPorPhoneId`).
3. `message_echoes` (a staff member replied from the phone — WhatsApp coexistence) are saved as `humano` and flip the conversation to `atendido_por = 'humano'`.
4. Dedupes by `wa_message_id` (Meta retries), saves the message, logs an `eventos` row.
5. If `atendido_por === 'humano'`, the AI stays silent. Automatic escalation only sets `motivo_escalacao`; it does **not** silence the AI.
6. Checks the monthly message cap (`lib/limites.js`), then calls `responder()` and executes the returned tool actions (`registrar_agendamento`, `pedir_documento`, `registrar_negociacao`, `chamar_equipe`), alerting the owner via WhatsApp.
7. Always returns 200 (otherwise Meta resends); errors go to `eventos` + owner alert.

**Agent — `lib/agente.js`:** builds the system prompt per call from that company's catalog (plus today's date in Brasília time, so the model doesn't guess the year). Runs up to 3 tool-use rounds; tool results are a stub `"ok, registrado"` — side effects happen in the webhook afterward. Only the last round's text is sent to the customer. Messages with `autor = 'sistema'` are fed back as assistant notes ("já registrado, não registrar de novo") — this is the mechanism that prevents duplicate actions across turns, so any new tool action should write such a note.

**Auth — `empresaDaRequisicao` in `lib/db.js`:** panel requests send `x-senha`. `PAINEL_SENHA` sees all active companies; a company's `senha_painel` sees only itself. Every panel route must resolve the company through this and filter by `emp.id` (e.g. verify a `conversa`/`conta` belongs to that company before mutating it).

**Other routes:** `conversas` (panel list), `enviar` (human takes over / replies / hands back to AI), `contas` (receivables CRUD, paste-from-spreadsheet import with dedupe on phone+value+due date), `cobranca` (sends Meta-approved templates `lembrete_vencimento` / `aviso_vencimento`, business hours 8–20h Brasília, at most once a week per account), `gestor` (daily owner summary; Vercel cron in `vercel.json` hits GET with `Bearer CRON_SECRET` and loops all companies; all numbers are computed, never AI-generated).

**Panel — `app/page.js`:** a single client component with inline styles; polls `/api/conversas` every 10s.

**Monthly cap — `lib/limites.js`:** usage is counted from `eventos` rows of types `resposta_ia`, `cobranca_enviada`, `aviso_enviado`, `resumo_enviado`. New outbound message types must log one of these (or be added to the list) to be counted.

## Gotchas

- Clients (`db`, Anthropic) are lazily created so `next build` works without env vars; keep that pattern. Route handlers declare `export const dynamic = "force-dynamic"`.
- Timezone is handled by hand as UTC−3 (`Date.now() - 3 * 3600000`) throughout.
- Phone numbers are normalized to digits with `55` DDI (`normalizarTelefone`); sending to the company's own number is rejected up front because Meta only returns a generic error.
- `supabase/schema.sql` is out of date with the code: it lacks `empresas` columns (`slug`, `phone_number_id`, `whatsapp_token`, `dono_whatsapp`, `senha_painel`, `teto_mensagens`, `catalogo`, `ativa`), `contas_receber.ultimo_aviso`, and the `contratos` and `documentos` tables. Update it when touching the data model.
- `app/page.js` calls `/api/levantamento`, which does not exist in the repo.
- The model ID is hardcoded in `lib/agente.js`.
