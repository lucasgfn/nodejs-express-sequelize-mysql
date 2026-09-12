# Guia Técnico de Migração — nodejs-express-sequelize-mysql

## Sumário

1. [Contextualização e Motivação](#1-contextualização-e-motivação)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Passo a Passo Executável (Roteiro de Migração)](#3-passo-a-passo-executável-roteiro-de-migração)
4. [Plano de Rollback e Testes de Validação](#4-plano-de-rollback-e-testes-de-validação)
5. [Riscos Aceitos e Pendências (Roadmap)](#5-riscos-aceitos-e-pendências-roadmap)
6. [Apêndice: Quadro de Melhorias (Pós-Peer Review)](#apêndice-quadro-de-melhorias-pós-peer-review)

## 1. Contextualização e Motivação

**Repositório original:** https://github.com/bezkoder/nodejs-express-sequelize-mysql

O projeto é uma API REST CRUD (`Tutorial`) em Node.js + Express + Sequelize + MySQL, no padrão de tutorial da bezkoder. Ele nunca foi atualizado como projeto de produção: dependências antigas, sem `engines` no `package.json`, sem containerização, sem suporte a variáveis de ambiente e com credenciais de banco hardcoded no repositório.

**Escopo desta migração:** o roteiro cobre dois dos três eixos possíveis — upgrade de linguagem/framework (Node.js, Express) e refatoração de deploy (containerização). **O eixo de banco de dados/ORM foi deliberadamente deixado fora de escopo**: `sequelize` e `mysql2` permanecem nas mesmas versões do projeto original (`^6.32.0` e `^2.3.3`). A única mudança que toca a camada de dados é a forma de configurá-la (credenciais fixas → variáveis de ambiente), que é parte do eixo de deploy/containerização, não do ORM em si.

### Cenário Atual 

| Item | Versão/Estado |
|---|---|
| Node.js | Sem versão fixada (`engines` ausente); código já rodou historicamente em Node 14 |
| Express | `^4.18.2` |
| Sequelize | `^6.32.0` |
| mysql2 | `^2.3.3` |
| MySQL | Instância local, sem versão fixada |
| Configuração | Credenciais fixas em `app/config/db.config.js` (`localhost` / `root` / `123456` / `testdb`) |
| Deploy | Nenhum — `node server.js` direto na máquina host |
| Testes | Nenhum (`npm test` é placeholder que sempre falha) |

### Cenário Alvo 

| Item | Versão/Estado |
|---|---|
| Node.js | `>=22.0.0` (LTS "Jod") |
| Express | `^5.2.1` |
| Sequelize | `^6.32.0` (mantido — fora de escopo desta migração) |
| mysql2 | `^2.3.3` (mantido — fora de escopo desta migração) |
| MySQL | `mysql:8.4` via container oficial |
| Configuração | Variáveis de ambiente (`.env`, carregado via `dotenv`), com `.env.example` versionado |
| Deploy | `Dockerfile` + `docker-compose.yml` (app + MySQL, com healthcheck) |
| Testes | Script de smoke test (`scripts/smoke-test.js`) cobrindo o fluxo CRUD completo, ligado a `npm test` |

### Justificativa técnica

- **Node.js 22 LTS**: versões antigas do Node saem de suporte de segurança, têm V8 desatualizado (perda de performance e de APIs modernas como `fetch` nativo, usado inclusive pelo próprio smoke test realizado no guia) e dificultam a instalação de dependências mais novas, que passam a exigir Node mais recente.
- **Express 5**: primeira major stable do framework desde 2014. Passou a rejeitar promises não tratadas automaticamente nas rotas (menos try/catch “esquecido”), corrigiu vulnerabilidades de ReDoS no roteamento antigo (`path-to-regexp`) e larga o suporte ao Node < 18. A migração deste projeto específico foi de baixo risco: as rotas usam apenas parâmetros simples (`/:id`), sem *wildcards* (`*`) nem regex customizada, que são os padrões que quebram entre v4 e v5.
- **Sequelize e mysql2 mantidos na versão original**: decisão explícita de escopo do responsável pelo projeto — esta migração cobre linguagem/framework e deploy, não o eixo de banco de dados/ORM. Isso tem um custo real e vale deixar registrado: `npm audit` reporta vulnerabilidades **críticas** nas versões mantidas (RCE e injeção de código em `mysql2 <=3.9.7`, SQL injection em `sequelize` via cast de coluna JSON), além de uma moderada em `uuid` (transitiva do `sequelize`). O risco foi aceito conscientemente para este entregável; uma migração real de produção precisaria endereçar o eixo de ORM/driver antes ou logo após esta.
- **Variáveis de ambiente**: elimina credenciais em texto puro no repositório (risco de segurança básico) e é pré-requisito para rodar o mesmo container em dev/homologação/produção sem alterar código.
- **Containerização**: elimina o problema “funciona na minha máquina”, fixa a versão do MySQL usada por todos os desenvolvedores e cria uma base para deploy em qualquer orquestrador (Compose, Swarm, Kubernetes) no futuro.

## 2. Pré-requisitos

Ferramentas necessárias na máquina de quem for executar a migração:

| Ferramenta | Versão mínima | Verificar com |
|---|---|---|
| Node.js | 22.0.0 | `node -v` |
| npm | 10.x (vem com o Node 22) | `npm -v` |
| Docker Engine | 24+ | `docker --version` |
| Docker Compose plugin | v2 | `docker compose version` |
| Git | qualquer versão recente | `git --version` |

Dependências de aplicação (gerenciadas via `npm`, definidas em `package.json`):

- `express@^5.2.1`
- `sequelize@^6.32.0` (mantido — fora de escopo)
- `mysql2@^2.3.3` (mantido — fora de escopo)
- `cors@^2.8.6`
- `dotenv@^17.4.2` (nova — carrega `.env` em `server.js`)

Nenhum SDK ou ferramenta de sistema adicional é necessária além do Docker (o MySQL passa a rodar em container, não é mais pré-requisito instalar MySQL na máquina host).

## 3. Passo a Passo Executável (Roteiro de Migração)

> Todos os comandos abaixo foram executados e validados neste guia a partir da raiz do repositório.

### 3.1. Clonar o repositório e preparar um ponto de restauração

```bash
git clone https://github.com/bezkoder/nodejs-express-sequelize-mysql.git
cd nodejs-express-sequelize-mysql

git checkout -b migration
git tag pre-migration-baseline
```

### 3.2. Atualizar `package.json`

Adicionar `engines`, o script `start`, apontar `test` para o smoke test (com `test:smoke` como alias explícito) e atualizar as versões das dependências:

```diff
   "main": "server.js",
+  "engines": {
+    "node": ">=22.0.0"
+  },
   "scripts": {
+    "start": "node server.js",
-    "test": "echo \"Error: no test specified\" && exit 1"
+    "test": "node scripts/smoke-test.js",
+    "test:smoke": "node scripts/smoke-test.js"
   },
   "dependencies": {
-    "cors": "^2.8.5",
-    "express": "^4.18.2",
+    "cors": "^2.8.6",
+    "dotenv": "^17.4.2",
+    "express": "^5.2.1",
     "mysql2": "^2.3.3",
     "sequelize": "^6.32.0"
   }
```

`mysql2` e `sequelize` permanecem sem alteração de versão — ver "Escopo desta migração" na seção 1.

Note que `test` deixa de ser o placeholder `exit 1` herdado do projeto original e passa a apontar para o smoke test. `test:smoke` é mantido como nome explícito para uso em pipelines. Deixar `npm test` falhando por definição, num projeto que passou a ter teste, é contradizer o próprio entregável: qualquer CI que rode o comando padrão acusaria falha.

### 3.3. Mover a configuração de banco para variáveis de ambiente

`app/config/db.config.js` passa a ler exclusivamente `process.env` — não há mais valores fixos no código, então o `.env` (ou as variáveis de ambiente equivalentes) passa a ser obrigatório para a aplicação conectar ao banco:

```js
module.exports = {
  HOST: process.env.DB_HOST,
  PORT: process.env.DB_PORT,
  USER: process.env.DB_USER,
  PASSWORD: process.env.DB_PASSWORD,
  DB: process.env.DB_NAME,
  dialect: "mysql",
  pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
};
```

`app/models/index.js` passa a repassar `port` para o construtor do Sequelize e remove a opção obsoleta `operatorsAliases` (sem efeito desde a série 6, era resquício da migração anterior a partir do Sequelize 5).

`server.js` carrega o `.env` no topo do arquivo e passa a ler `PORT`/`CORS_ORIGIN` do ambiente:

```js
require("dotenv").config();
// ...
var corsOptions = {
  origin: process.env.CORS_ORIGIN
};
// ...
const PORT = process.env.PORT;
```

Como a configuração passou a ser **obrigatória** (não há mais valores fixos de fallback no código), `server.js` valida a presença de todas as variáveis antes de qualquer outra coisa e aborta com mensagem nomeando o que falta:

```js
const REQUIRED_ENV = [
  "PORT", "CORS_ORIGIN",
  "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"
];

const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
  console.error(
    "ERRO DE CONFIGURACAO: variaveis de ambiente obrigatorias ausentes: " +
      missingEnv.join(", ")
  );
  console.error(
    "Copie .env.example para .env e preencha os valores antes de subir a aplicacao."
  );
  process.exit(1);
}
```

Sem essa checagem a ausência de configuração produzia falhas silenciosas e difíceis de diagnosticar, não erros: `app.listen(undefined)` **sobe com sucesso** numa porta aleatória atribuída pelo sistema operacional (o log imprime `Server is running on port undefined.` e a porta publicada pelo Compose não responde), e credenciais indefinidas só estouravam depois, na primeira conexão, com um erro de banco que não diz que o problema era o `.env` faltando. Comportamento verificado:

```console
$ node server.js          # com .env ausente ou incompleto
ERRO DE CONFIGURACAO: variaveis de ambiente obrigatorias ausentes: PORT, CORS_ORIGIN, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
Copie .env.example para .env e preencha os valores antes de subir a aplicacao.
$ echo $?
1
```

`server.js` também troca o `db.sequelize.sync()` de tentativa única por um *retry* com backoff. Isso não é opcional em Docker Compose: a imagem oficial do MySQL sobe um servidor temporário (só via socket Unix, sem rede) para rodar os scripts de inicialização, reporta *healthy* nesse estado, derruba esse servidor temporário e só então sobe o servidor definitivo com a rede habilitada — nesse intervalo, `depends_on: condition: service_healthy` já liberou o container da app, e uma tentativa única de `sync()` pode cair exatamente na janela em que a porta 3306 ainda está de pé caindo (`ECONNREFUSED`), deixando a tabela `tutorials` nunca criada. Isso foi reproduzido de verdade ao validar este guia (ver seção 4.1):

```js
function syncDbWithRetry(retriesLeft = 10, delayMs = 3000) {
  db.sequelize.sync()
    .then(() => {
      console.log("Synced db.");
    })
    .catch((err) => {
      console.error("Failed to sync db: " + err.message);
      if (retriesLeft > 0) {
        console.error(`Nova tentativa em ${delayMs}ms (${retriesLeft} restantes).`);
        setTimeout(() => syncDbWithRetry(retriesLeft - 1, delayMs), delayMs);
        return;
      }
      console.error(
        "ERRO FATAL: nao foi possivel sincronizar o banco apos todas as tentativas. " +
          "Encerrando o processo para que a falha fique visivel em 'docker compose ps'."
      );
      process.exit(1);
    });
}

syncDbWithRetry();
```

O ramo final importa tanto quanto o retry. Esgotadas as 10 tentativas (30 segundos), a versão sem esse tratamento **continuava servindo HTTP normalmente** sem a tabela `tutorials` existir: todas as rotas de CRUD respondiam erro, `docker compose ps` mostrava o container como `Up`, e a única pista do problema era uma linha de log perdida no meio da saída. Encerrando o processo, a falha fica visível onde se olha primeiro (`docker compose ps` passa a mostrar o container reiniciando) e a política `restart: unless-stopped` do Compose ainda dá novas chances ao container caso o MySQL esteja apenas demorando mais que o previsto.

Criar `.env.example` (versionado) e ignorar `.env` real no Git:

```bash
cp .env.example .env   # cada desenvolvedor cria o seu, com valores locais
echo ".env" >> .gitignore
```

### 3.4. Instalar as novas dependências

```bash
npm install
```

Saída obtida ao rodar este passo neste guia (instalação limpa, `node_modules` removido antes):

```
added 102 packages, and audited 103 packages in 13s
31 packages are looking for funding
3 vulnerabilities (1 moderate, 2 critical)
```

`npm audit` detalha a origem das 3 vulnerabilidades — todas em dependências mantidas **intencionalmente** na versão original (ver "Escopo desta migração", seção 1):

- **`mysql2 <=3.9.7` (crítica)**: RCE via `readCodeFor`, injeção arbitrária de código, prototype pollution/poisoning e cache poisoning. Corrigido a partir da `3.23.4`, mas atualizar o driver está fora do escopo deste roteiro.
- **`sequelize` (crítica)**: SQL injection via cast de coluna JSON e via Oracle DB; também depende de uma versão vulnerável de `uuid`.
- **`uuid <11.1.1` (moderada)**: bounds check ausente em `v3/v5/v6`, transitiva do `sequelize`.

Decisão registrada: como o eixo de banco de dados/ORM não faz parte desta migração, o risco é aceito para efeito deste entregável e a correção fica documentada como pendência explícita — não é um risco desconhecido nem ignorado, é um trade-off de escopo. Um projeto real que siga este guia deveria tratar a atualização de `mysql2`/`sequelize` como o próximo item do roadmap, antes de ir para produção.

### 3.5. Criar o `Dockerfile` da aplicação

```dockerfile
FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

USER node

EXPOSE 8080

CMD ["node", "server.js"]
```

Duas escolhas nesse arquivo merecem justificativa.

**`npm ci` em vez de `npm install`.** O repositório tem `package-lock.json` versionado (lockfile v3, com `express@5.2.1`, `dotenv@17.4.2` e `cors@2.8.6` já resolvidos). `npm ci` instala exatamente essa árvore, sem consultar os ranges `^`, e **nunca escreve** no lock.

Vale ser preciso sobre o ganho, porque é fácil exagerá-lo: enquanto o lock estiver presente no contexto de build e em sincronia com o `package.json`, `npm install` **também** é determinístico — ele respeita o lock e não sobe de versão sozinho. A diferença aparece justamente quando algo está fora do lugar, e é aí que ela importa:

| Situação | `npm install` | `npm ci` |
|---|---|---|
| Lock ausente do contexto de build (não versionado, ou barrado pelo `.dockerignore`) | Resolve os ranges do zero e constrói a imagem em silêncio, com versões que ninguém escolheu | Aborta o build |
| `package.json` alterado sem regenerar o lock | Resolve a diferença por conta própria e reescreve o lock **dentro do container** — arquivo descartado no fim do build, deixando a imagem sem registro de qual árvore ela contém | Aborta o build |

Comprovado ao validar este guia: com uma dependência declarada no `package.json` e ausente do lock, `npm ci` sai com código 1 e aborta antes de instalar qualquer coisa:

```console
npm ERR! code EUSAGE
npm ERR! `npm ci` can only install packages when your package.json and
npm ERR! package-lock.json or npm-shrinkwrap.json are in sync.
npm ERR! Missing: is-odd@3.0.1 from lock file
```

A precisão importa — divergência de *texto* não basta: afrouxar um range de `^2.8.6` para `^2.8.5` com o lock travado em `2.8.6` **não** quebra o `npm ci`, porque a versão travada continua satisfazendo o range. O critério é o lock conseguir ou não satisfazer o `package.json`.

**A escolha não é por desempenho.** Medido neste projeto, com `node_modules` removido antes de cada rodada: `npm ci` 0,71s contra `npm install` 0,70s — diferença nenhuma. Com o lock em dia, o `npm install` praticamente não tem o que resolver. O que se ganha com o `npm ci` é a garantia de que o build falha em vez de improvisar.

**`ENV NODE_ENV=production`.** O Express muda de comportamento conforme essa variável: em produção ele habilita cache de views, deixa de expor *stack traces* nas respostas de erro padrão e evita trabalho de desenvolvimento no caminho das requisições. Sem ela, uma imagem "de produção" roda com os defaults de desenvolvimento.

A ordem das instruções também não é acidental: `COPY package*.json ./` vem antes do `COPY . .` para que a camada do `npm ci` só seja invalidada quando as dependências mudarem, e não a cada alteração de código-fonte.

Criar também `.dockerignore` na raiz — **passo obrigatório, não opcional**. Sem ele, `COPY . .` envia o `node_modules` já instalado no host (centenas de arquivos pequenos) para o contexto de build, e no macOS com Docker Desktop isso é medido em minutos, não segundos: em um teste real deste guia, `docker compose up --build` ficou **mais de 16 minutos preso** apenas transferindo o contexto de build antes de sequer começar o `npm install` dentro do container, até identificarmos a causa e adicionar o arquivo:

```
node_modules
npm-debug.log
.git
.gitignore
.env
.DS_Store
scripts
```

Duas entradas valem explicação. `.env` é excluído de propósito: as credenciais chegam ao container pelo `env_file`/`environment` do Compose em tempo de execução, não assadas dentro da imagem — uma imagem com `.env` embutido carrega segredo para qualquer lugar em que ela for publicada. `scripts` também é excluído porque o smoke test roda **do host contra a porta publicada**, exercitando o caminho real de rede que um cliente usaria; ele não precisa existir dentro da imagem. Consequência a registrar: `npm test` funciona no host, não dentro do container da aplicação.

### 3.6. Criar o `docker-compose.yml` (app + MySQL)

```yaml
services:
  mysql:
    image: mysql:8.4
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_PASSWORD:-123456}
      MYSQL_DATABASE: ${DB_NAME:-testdb}
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-p${DB_PASSWORD:-123456}"]
      interval: 5s
      timeout: 5s
      retries: 10

  app:
    build: .
    restart: unless-stopped
    env_file:
      - .env
    environment:
      DB_HOST: mysql
    ports:
      - "${PORT:-8080}:8080"
    depends_on:
      mysql:
        condition: service_healthy

volumes:
  mysql_data:
```

Note que `DB_HOST` é forçado para `mysql` (o nome do serviço, resolvido pela rede interna do Compose) independente do que estiver em `.env` — o `.env` local pode conter `DB_HOST=localhost` para uso fora do Docker, e ele é sobrescrito aqui.

### 3.7. Subir a stack

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f app
```

Esperado no log do serviço `app`: `Server is running on port 8080.` seguido de `Synced db.` (uma ou mais linhas `Failed to sync db: connect ECONNREFUSED ...` antes disso são normais — é o *retry* da seção 3.3 absorvendo a janela de reinício do MySQL; o que importa é terminar em `Synced db.`).

## 4. Plano de Rollback e Testes de Validação

### 4.1. Validação

Com a stack no ar (`docker compose up -d`), rodar o smoke test incluído em `scripts/smoke-test.js`, que exercita o CRUD completo via HTTP (`GET /`, `POST`, `GET /:id`, `PUT /:id`, `DELETE /:id`):

```bash
npm test          # ou, com o nome explicito: npm run test:smoke
```

Saída obtida ao validar este guia, rodando de verdade contra `docker compose up --build -d` (containers `app` e `mysql`, volume novo, sem atalhos):

```console
$ npm test

> nodejs-express-sequelize-mysql@1.0.0 test
> node scripts/smoke-test.js

PASSOU - GET / responds with welcome message
PASSOU - POST /api/tutorials creates a tutorial
PASSOU - GET /api/tutorials/:id retrieves the created tutorial
PASSOU - PUT /api/tutorials/:id updates the tutorial
PASSOU - DELETE /api/tutorials/:id removes the tutorial

TODOS OS 5 TESTES PASSARAM!.
```

O script termina com código de saída `1` se qualquer verificação falhar e `0` se todas passarem, permitindo uso em CI. Ambos os caminhos foram verificados:

```console
$ npm test > /dev/null 2>&1; echo $?
0
$ SMOKE_BASE_URL=http://localhost:9999 node scripts/smoke-test.js > /dev/null 2>&1; echo $?
1
```

A variável `SMOKE_BASE_URL` permite apontar o mesmo script para outro host/porta (usada acima para forçar o caminho de falha, e útil para rodar o teste contra um ambiente remoto).

**Validação manual complementar:**

```bash
curl http://localhost:8080/                       # mensagem de boas-vindas
curl http://localhost:8080/api/tutorials           # lista (vazia no primeiro boot)
curl -X POST http://localhost:8080/api/tutorials \
  -H "Content-Type: application/json" \
  -d '{"title":"teste","description":"validação pós-migração","published":true}'
```

**Nota sobre a validação deste guia:** todos os passos foram executados de ponta a ponta — não só o código fora de container, mas o `docker compose up --build -d` real, contra um MySQL 8.4 em container, com volume novo (`docker compose down -v` antes de cada tentativa, para não validar em cima de um estado já "quente"). Duas execuções expuseram problemas reais que só apareceriam em uso de verdade, e que foram corrigidos no próprio roteiro acima:

1. **Build travado por ausência de `.dockerignore`** (seção 3.5): sem o arquivo, o build enviava o `node_modules` do host para o contexto e ficou mais de 16 minutos preso só nessa transferência.
2. **Corrida entre o healthcheck do MySQL e a disponibilidade real da rede** (seção 3.3): mesmo com `depends_on: condition: service_healthy`, a primeira tentativa de `db.sequelize.sync()` falhou com `ECONNREFUSED` porque o container `mysql` ainda estava no ciclo de reinício interno do próprio entrypoint oficial da imagem. Resolvido trocando a tentativa única por *retry* com backoff.

Depois dessas duas correções, `docker compose up --build -d` seguido de `npm test` passou de forma limpa e repetida, inclusive a partir de um volume novo do zero — não é um resultado obtido "na primeira tentativa e nunca mais verificado".

**Revalidação após a revisão pós-peer review:** as alterações descritas no apêndice (entre elas a troca de `npm install` por `npm ci` na imagem e a validação de variáveis de ambiente) foram revalidadas pelo mesmo procedimento, do zero — `docker compose down -v`, `docker compose up --build -d`, `npm test`. Resultado: `mysql` reportado `healthy`, log do `app` terminando em `Synced db.` e os 5 testes passando. Nesta execução específica **não houve** nenhuma linha `Failed to sync db`, porque o MySQL já estava com a rede disponível quando o app tentou conectar — o que não torna o *retry* dispensável: ele cobre justamente a execução em que isso não acontece, como ocorreu na validação original. Uma observação de log adicional, esperada: o container imprime `injected env (0) from .env`, ou seja, zero variáveis vindas de arquivo — o `.env` é excluído da imagem pelo `.dockerignore` e toda a configuração chega pelo `env_file`/`environment` do Compose em tempo de execução, exatamente como projetado.

### 4.2. Rollback

Se a validação falhar ou surgir qualquer problema crítico:

```bash
# Derrubar os containers e remover o volume de dados criado pela migração
docker compose down -v

# Reverter todos os arquivos de código para o estado anterior à migração
git checkout pre-migration-baseline -- .
rm -f Dockerfile docker-compose.yml .dockerignore .env.example
rm -rf scripts

# Reinstalar as dependências antigas
rm -rf node_modules
npm install

# Subir a aplicação como antes (MySQL local, sem Docker)
node server.js
```

Critério de sucesso do rollback: `node server.js` volta a subir e responder em `http://localhost:8080/` usando a configuração fixa original (`localhost` / `root` / `123456` / `testdb`), sem exigir Docker nem `.env`.

> **Nota sobre o rollback após esta revisão:** `git checkout pre-migration-baseline -- .` restaura também o `server.js` original, que lê as credenciais fixas de `app/config/db.config.js` — portanto a validação de variáveis de ambiente introduzida na seção 3.3 desaparece junto, como esperado. O rollback continua completo e não deixa resíduo de configuração obrigatória.

## 5. Riscos Aceitos e Pendências (Roadmap)

Esta seção consolida, num só lugar, o que **não** foi resolvido por esta migração. Os itens estão registrados como decisão consciente, não como omissão: o valor de um guia de migração está tanto no que ele faz quanto no que ele declara não ter feito.

| # | Pendência | Severidade | Impacto se não tratada | Ação recomendada |
|---|---|---|---|---|
| P1 | `mysql2@2.3.3` mantido (fora de escopo) | **Crítica** | RCE via `readCodeFor`, injeção arbitrária de código, *prototype pollution* e *cache poisoning* | Atualizar para `>=3.23.4` e revalidar o smoke test |
| P2 | `sequelize@6.32.0` mantido (fora de escopo) | **Crítica** | SQL injection via cast de coluna JSON | Atualizar para o patch mais recente da série 6 |
| P3 | `uuid <11.1.1`, transitiva do `sequelize` | Moderada | *Bounds check* ausente em `v3/v5/v6` | Resolvida junto com P2 |
| P4 | Esquema criado por `sequelize.sync()`, sem *migrations* | Alta | `sync()` não versiona schema nem sabe alterar tabela existente com segurança; em produção, mudança de modelo vira alteração manual ou perda de dados | Adotar `sequelize-cli` com migrations versionadas antes do primeiro deploy real |
| P5 | Senha padrão `123456` em `.env.example` e no *fallback* do Compose | Alta | Credencial trivial versionada; se copiada para outro ambiente sem troca, banco exposto | Gerar senha por ambiente; em produção usar cofre de segredos (Docker secrets, Vault, SSM) |
| P6 | Porta `3306` do MySQL publicada no host | Média | Banco acessível fora da rede interna do Compose — conveniente em dev, indevido em produção | Remover o mapeamento `ports` do serviço `mysql` no arquivo de produção; o app já o alcança pela rede interna |
| P7 | Cobertura de teste limitada a smoke test de CRUD | Média | Valida que a stack sobe e responde, não regras de negócio nem casos de erro | Adicionar testes unitários do controller e casos de falha (404, payload inválido) |

Ordem sugerida de ataque: **P1/P2/P3 juntos** (é o mesmo eixo de ORM/driver e o de maior severidade), depois **P4** (bloqueia deploy real), depois **P5/P6** (endurecimento de ambiente), e por fim **P7/P8/P9** (qualidade e automação).

## Apêndice: Quadro de Melhorias (Pós-Peer Review)

### Parte A — Feedbacks recebidos e tratamento dado

Os três colegas revisaram a versão anterior deste guia e **nenhum apontou correção, erro ou lacuna** — os três pareceres foram integralmente favoráveis, cobrindo os mesmos critérios da atividade. O quadro abaixo são as avaliações recebidas:

| Colega | Pontos destacados no parecer | Critério validado | Ação tomada |
|---|---|---|---|
| 1 | "Detalha perfeitamente o cenário de origem e destino, mapeia todas as dependências/pré-requisitos e justifica claramente a migração"; "roteiro impecável, sequencial, com comandos e configurações formatados adequadamente, permitindo reprodução direta sem erros"; "contém plano de rollback detalhado e executável, acompanhado de etapas claras de testes/validação" | Os três critérios da atividade (contextualização, roteiro, rollback/validação) | Nenhuma alteração exigida. Estrutura das seções 1 a 4 mantida; os acréscimos desta versão são aditivos e não reescrevem o que foi validado |
| 2 | "Trabalho bem organizado e bem claro de ser compreendido, cumpre todos os requisitos" | Organização e clareza | Nenhuma alteração exigida. Como reforço de navegabilidade — e não correção — foram acrescentados sumário e a seção 5 consolidando riscos que antes apareciam dispersos |
| 3 | "Bem detalhado e com plano de validação e teste e rollback bem definido"; "boa explicação e descrição dos passos a serem seguidos, migração congruente" | Validação, teste, rollback e congruência dos passos | Nenhuma alteração exigida. A congruência elogiada motivou uma auditoria de coerência documento↔código, que expôs os itens B1 e B5 da Parte B |

**Consequência metodológica:** um peer review sem apontamentos não autoriza entregar a versão final idêntica à revisada — apenas desloca a responsabilidade da melhoria para o autor. Por isso foi conduzida uma autorrevisão técnica, com o próprio guia lido como se fosse de terceiros e o código auditado linha a linha à procura de divergências entre o que o documento promete e o que o repositório faz. O resultado está na Parte B.

### Parte B — Melhorias adotadas

| # | Melhoria aplicada | Problema real que corrige | Onde |
|---|---|---|---|
| B1 | `npm test` passou a executar o smoke test, em vez do placeholder `echo ... && exit 1` herdado do projeto original | O documento anunciava, na tabela to-be, que o projeto passou a ter testes, enquanto o comando padrão de teste continuava **falhando por definição**. Qualquer CI que rodasse `npm test` acusaria falha num projeto declarado como testado — incoerência entre documento e repositório | `package.json`; seções 1 e 3.2 |
| B2 | `npm install --omit=dev` → `npm ci --omit=dev`, e `ENV NODE_ENV=production` adicionado à imagem | `npm install` improvisa quando o lock não está presente ou não satisfaz o `package.json`: resolve as versões por conta própria e produz, em silêncio, uma imagem cuja árvore de dependências não corresponde ao lock versionado. `npm ci` aborta o build nesses casos (`EUSAGE ... Missing: <pacote> from lock file`), transformando um desvio silencioso em erro visível. Sem `NODE_ENV=production`, a imagem "de produção" rodava com os defaults de desenvolvimento do Express | `Dockerfile`; seção 3.5 |
| B3 | Validação *fail-fast* das 7 variáveis de ambiente obrigatórias, abortando com `exit 1` e nomeando as ausentes | Com a configuração migrada para `process.env` e sem valores fixos de fallback, a ausência de `.env` não produzia erro, produzia **falha silenciosa**: verificou-se que `app.listen(undefined)` sobe com sucesso numa porta aleatória atribuída pelo SO (log `Server is running on port undefined.`), de modo que a porta publicada pelo Compose simplesmente não responde e nada no log indica a causa. Credenciais ausentes só estouravam depois, como erro de banco | `server.js`; seção 3.3 |
| B4 | O retry de `sequelize.sync()` passou a registrar cada tentativa e a encerrar o processo com erro fatal ao esgotar as 10 tentativas | Esgotado o retry, o processo **continuava servindo HTTP sem a tabela `tutorials` existir**: todas as rotas de CRUD respondiam erro, `docker compose ps` exibia o container como `Up`, e a única pista era uma linha de log perdida na saída. Encerrando o processo, a falha aparece onde se olha primeiro, e o `restart: unless-stopped` ainda dá novas chances ao container | `server.js`; seção 3.3 |
| B5 | Saída documentada do smoke test corrigida para a saída real do script | A seção 4.1 registrava a saída como `PASS - ...` / `All 5 checks passed.`, mas `scripts/smoke-test.js` foi traduzido depois da escrita do guia e imprime `PASSOU - ...` / `TODOS OS 5 TESTES PASSARAM!.`. Num documento cujo valor é ser reproduzível, uma saída esperada que não corresponde à real faz o leitor duvidar de que o passo tenha sido executado | Seção 4.1 |
| B6 | Acréscimo de sumário, da seção 5 (Riscos Aceitos e Pendências) e das justificativas explícitas de `.dockerignore` e da ordem das camadas do `Dockerfile` | As vulnerabilidades críticas aceitas apareciam dispersas nas seções 1 e 3.4, sem lugar único onde o leitor pudesse ver o passivo técnico completo e a ordem de ataque sugerida. Decisões de build (por que `.env` e `scripts` ficam fora da imagem, por que `COPY package*.json` vem antes de `COPY . .`) estavam implícitas no código, sem justificativa no texto | Sumário, seções 3.5 e 5 |

### Resumo em tópicos

- **Feedbacks dos pares:** 3 pareceres, todos favoráveis, **nenhuma correção solicitada**; nenhum ponto do documento foi contestado e a estrutura validada foi preservada.
- **Alterações de código nesta revisão:** 4 (`package.json`, `Dockerfile`, e duas em `server.js`), todas de correção de defeito real, nenhuma de reescrita estética.
- **Alterações de documento nesta revisão:** correção de uma divergência documento↔código (B5), consolidação do passivo técnico em seção própria (B6, seção 5), sumário e justificativas de build antes implícitas.
- **Origem das melhorias:** autorrevisão técnica do autor, declarada como tal — nenhuma alteração desta versão é atribuída a feedback que não foi dado.
- **Revalidação:** após as alterações, a stack foi derrubada com remoção de volume (`docker compose down -v`), reconstruída (`docker compose up --build -d`) e reaprovada pelo smoke test, conforme registrado na seção 4.1.
