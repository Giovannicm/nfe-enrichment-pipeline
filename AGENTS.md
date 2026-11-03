# AGENTS.md

Guia para agentes de código (Claude Code, Cursor, Codex etc.) que trabalham neste repositório. Para o contexto de negócio, os contratos e o fluxo completo, leia o [README.md](README.md).

## Visão geral

Serviço NestJS que recebe a chave de acesso de uma NF-e (44 dígitos), grava a nota em `ANALISE` e pede o enriquecimento a um provedor externo de forma assíncrona. O resultado volta por webhook, passa pela fila, e só então a nota vira `APROVADA` ou `REJEITADA`.

```
POST /nfes ──tx──> nfes + outbox ──OutboxRelay──> queue_messages ──QueueWorker──> ProviderClient
POST /webhooks/provider ──> queue_messages ──QueueWorker──> UPDATE nfes (ANALISE -> APROVADA | REJEITADA)
```

**Stack:** Node.js 22, NestJS 11, TypeScript 5 (CommonJS), TypeORM 0.3, PostgreSQL 16, Jest 30 + ts-jest + Supertest, Docker Compose.

## Comandos

```bash
cp .env.example .env                                   # obrigatório antes do compose
docker compose up --build                              # API em :3000, Postgres em 127.0.0.1:5432

docker compose --profile test run --rm --build test    # suíte completa em container

# Testes locais (precisam do Postgres de teste em 127.0.0.1:5433)
npm ci
docker compose --profile test up -d --wait db-test
npm test                                               # ou: npm run test:cov
npx jest test/nfes.e2e.spec.ts -t "same result"        # filtrar por nome

npm run build                                          # tsc -p tsconfig.build.json
npx tsc --noEmit                                       # checa src e test
```

Não existe lint nem formatter configurado. Siga o estilo dos arquivos vizinhos: aspas simples, ponto e vírgula, 2 espaços, linhas de até cerca de 120 colunas.

## Estrutura

| Caminho | Responsabilidade |
| --- | --- |
| `src/nfes/contracts.ts` | Tópicos (`nfe.enrichment.requested`, `nfe.enrichment.result`), interfaces das mensagens e `ACCESS_KEY_PATTERN` |
| `src/nfes/nfes.controller.ts` | `POST /nfes`, `GET /nfes/:id`, `POST /webhooks/provider` |
| `src/nfes/nfes.service.ts` | Cria a nota com a entrada da outbox na mesma transação; o webhook só publica na fila |
| `src/nfes/nfes.consumers.ts` | Handlers da fila: chamar o provedor e aplicar o resultado (com `SELECT ... FOR UPDATE`) |
| `src/nfes/evaluate-result.ts` | Regra pura de aprovação/rejeição. Toda regra sobre os dados do provedor fica aqui |
| `src/nfes/nfes.dto.ts` | DTOs com `class-validator` (HTTP e mensagens consumidas) |
| `src/nfes/webhook-token.guard.ts` | Valida o header `x-webhook-token` com comparação em tempo constante |
| `src/outbox/` | Entidade `OutboxEntry`, `Outbox` (grava na transação do chamador) e `OutboxRelay` (publica no `MessageBus`) |
| `src/queue/` | Entidade `QueueMessage`, `MessageBus` (fila em tabela), `QueueWorker` e `PollingLoop` |
| `src/provider/provider.client.ts` | `ProviderClient` abstrato; `SimulatedProviderClient` não faz nada (não há fornecedor real) |
| `src/database/` | Config do TypeORM, `data-source.ts` para a CLI e migrations |
| `src/logging/` | Logger de eventos de uma linha e middleware de log HTTP |
| `test/nfes.e2e.spec.ts` | E2E contra Postgres real, agrupados pelos requisitos do enunciado |
| `test/support/` | `env.ts` (variáveis de teste) e `FakeProvider` |

Testes unitários ficam ao lado do código (`src/**/*.spec.ts`). E2E e testes de migration ficam em `test/`.

## Regras de negócio (invariantes)

Não quebre estas regras. Cada uma é coberta por testes e várias também por constraints no banco:

1. A nota nasce em `ANALISE`, sem `approved_at`.
2. Só vai para `APROVADA` com `cnpj`, `amount` e `issueDate` válidos e `cancelled === false`.
3. Resultado cancelado, incompleto ou inválido leva a `REJEITADA`, com `rejection_reason` preenchido. O cancelamento tem prioridade na mensagem do motivo.
4. A mensagem de volta nunca cria nota. Uma chave desconhecida encerra o consumo sem gravar nada.
5. A mesma chave não gera duas notas: `UNIQUE (access_key)`. A API responde `409` com o `nfeId` existente, inclusive em corrida (violação `23505`).
6. Uma mensagem de volta repetida ou divergente não altera uma nota já decidida: a linha é travada e o status é verificado.
7. Uma falha ao publicar não pode perder nem aprovar a nota: a nota e a outbox são gravadas na mesma transação, e o relay tenta de novo.

Constraints na tabela `nfes`: `approved_at_only_when_approved`, `reason_only_when_rejected`, `approved_requires_complete_data`.

## Convenções

- **Idioma:** código, identificadores, comentários, mensagens de log e de erro, nomes de testes e mensagens de commit em **inglês**. O README e a documentação para pessoas ficam em português.
- **Nomenclatura:** use `nfe` / `nfes` (tabela `nfes`, rota `/nfes`, `NfesService`, `nfeId`). Não use `invoice`, `nota` ou `notaFiscal` no código.
- **Status:** os valores persistidos e retornados pela API são do contrato e ficam em português: `ANALISE`, `APROVADA`, `REJEITADA`. O mesmo vale para os da fila: `PENDING`, `PROCESSED`, `DEAD`.
- **Validação:** use `class-validator` / `class-transformer`. Não valide manualmente no controller. O DTO do webhook (`EnrichmentResultDto`) recusa **apenas** a chave inválida. Dados ausentes ou inválidos precisam chegar à fila para a nota ser rejeitada com motivo.
- **Mensagens da fila:** são validadas ao consumir. Payload fora do contrato gera `InvalidMessageError` e vai direto para `DEAD`, sem nova tentativa.
- **Handlers da fila** recebem o `EntityManager` da transação do worker. Faça toda escrita por ele e retorne um `CommittedLog`, que só é logado depois do commit. Handlers precisam ser idempotentes: a entrega é *at-least-once*.
- **Outbox:** qualquer mensagem gerada por uma mudança de dados usa `Outbox.add(manager, ...)` dentro da mesma transação. Não publique direto no `MessageBus` a partir de um fluxo de escrita de negócio.
- **Acesso a dados:** use repositórios injetados com `@InjectRepository` e grave com `save`, sem `manager.query`. Dentro de uma transação, use `manager.withRepository(this.repo)`. Os locks usam `findOne({ lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' } })`. SQL escrito à mão fica só nas migrations.
- **Saves parciais:** para atualizar, passe `{ id, ...campos }` ao `save`, em vez de alterar a entidade carregada. Assim, um caminho de falha não grava por engano um campo alterado antes do rollback.
- **Datas:** `availableAt` (fila), `approvedAt` e `updatedAt` são definidos pela aplicação (`new Date()`), não pelo `now()` do banco. Quando duas colunas precisam ser iguais, use o mesmo `Date`.
- **Logs:** objeto estruturado com `event` em `dominio.acao` (ex.: `nfe.created`, `queue.message_dead`) e `accessKey` para correlação. **Nunca** logue o token do webhook nem os dados do resultado (cnpj, amount etc.); existe teste para isso.
- **Configuração:** leia variáveis com `requiredEnv` / `numericEnv` de `src/config.ts`, que falham no startup em valores inválidos. Não use `@nestjs/config`.
- **Erros HTTP:** falha de infraestrutura ao gravar ou publicar responde `503` com mensagem genérica. Detalhes vão só para o log.

## Banco e migrations

- `synchronize` está desligado. Toda mudança de schema exige uma nova migration em `src/database/migrations/`, registrada em `databaseOptions()` (`src/database/database.config.ts`).
- As migrations rodam no startup da aplicação (`migrationsRun: true`). O `test/migrations.spec.ts` verifica revert + reapply, então implemente sempre o `down`.
- Não edite uma migration já commitada; crie outra.
- Scripts da CLI (`npm run migration:run|revert|show`) usam `dist/`, então rode `npm run build` antes.

## Testes

- O E2E sobe o `AppModule` real contra o Postgres de teste, troca `ProviderClient` pelo `FakeProvider` e roda os jobs manualmente com `relay.runCycle()` / `worker.runCycle()`. O polling fica desligado por `BACKGROUND_JOBS_ENABLED=false` em `test/support/env.ts`.
- Cada teste começa com `TRUNCATE nfes, outbox, queue_messages`, e a suíte roda com `--runInBand`. Não paralelize.
- O provedor é sempre simulado: o "retorno do provedor" é um `POST /webhooks/provider` com o token de teste. Não integre um fornecedor real.
- Para simular falhas, use `provider.remainingFailures` ou `jest.spyOn(...).mockRejectedValueOnce(...)`.
- Toda regra nova ou alterada precisa de teste no `describe` do requisito correspondente. Ao corrigir um bug, escreva primeiro o teste que falha.

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Uso |
| --- | --- | --- | --- |
| `DATABASE_URL` | sim | — | Conexão PostgreSQL |
| `WEBHOOK_TOKEN` | sim | — | Valor esperado no header `x-webhook-token` |
| `PORT` | não | `3000` | Porta HTTP |
| `POLL_INTERVAL_MS` | não | `1000` | Intervalo entre os ciclos do worker da fila |
| `OUTBOX_RELAY_INTERVAL_MS` | não | `5000` | Intervalo entre os ciclos do relay da outbox |
| `QUEUE_MAX_ATTEMPTS` | não | `5` | Entregas antes de `DEAD` |
| `QUEUE_REDELIVERY_DELAY_MS` | não | `5000` | Espera fixa entre tentativas da fila |
| `BACKGROUND_JOBS_ENABLED` | não | ligado | `false` desliga o relay e o worker |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | — | Credenciais do container `db` |

## Segurança e repositório

- O repositório é **público**. Nunca commite `.env`, tokens, senhas ou dumps. Use apenas valores de exemplo no `.env.example`.
- Commits seguem Conventional Commits em inglês (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- Fora do escopo: nuvem, broker gerenciado (a fila é a tabela `queue_messages`) e ferramentas reais de observabilidade.
- Ao mudar contrato, fluxo ou decisões de escopo, atualize o README: contratos, fluxo, "O que ficou de fora" e "Implementação da IA x Alterações".
