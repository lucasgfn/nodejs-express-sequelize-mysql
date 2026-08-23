# Guia Técnico de Migração — nodejs-express-sequelize-mysql

## 1. Contextualização e Motivação

**Repositório original:** https://github.com/bezkoder/nodejs-express-sequelize-mysql

O projeto é uma API REST CRUD (`Tutorial`) em Node.js + Express + Sequelize + MySQL, no padrão de tutorial da bezkoder. Ele nunca foi atualizado como projeto de produção: dependências antigas, sem `engines` no `package.json`, sem containerização, sem suporte a variáveis de ambiente e com credenciais de banco hardcoded no repositório.

**Escopo desta migração:** o roteiro cobre dois dos três eixos possíveis — upgrade de linguagem/framework (Node.js, Express) e refatoração de deploy (containerização). **O eixo de banco de dados/ORM foi deliberadamente deixado fora de escopo**: `sequelize` e `mysql2` permanecem nas mesmas versões do projeto original (`^6.32.0` e `^2.3.3`). A única mudança que toca a camada de dados é a forma de configurá-la (credenciais fixas → variáveis de ambiente), que é parte do eixo de deploy/containerização, não do ORM em si.

### Cenário Atual (as-is)

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

### Cenário Alvo (to-be)

| Item | Versão/Estado |
|---|---|
| Node.js | `>=22.0.0` (LTS "Jod") |
| Express | `^5.2.1` |
| Sequelize | `^6.32.0` (mantido — fora de escopo desta migração) |
| mysql2 | `^2.3.3` (mantido — fora de escopo desta migração) |
| MySQL | `mysql:8.4` via container oficial |
| Configuração | Variáveis de ambiente (`.env`, carregado via `dotenv`), com `.env.example` versionado |
| Deploy | `Dockerfile` + `docker-compose.yml` (app + MySQL, com healthcheck) |
| Testes | Script de smoke test (`scripts/smoke-test.js`) cobrindo o fluxo CRUD completo |

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

Adicionar `engines`, o script `start`, o script `test:smoke` e atualizar as versões das dependências:

```diff
   "main": "server.js",
+  "engines": {
+    "node": ">=22.0.0"
+  },
   "scripts": {
+    "start": "node server.js",
-    "test": "echo \"Error: no test specified\" && exit 1"
+    "test": "echo \"Error: no test specified\" && exit 1",
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

`server.js` também troca o `db.sequelize.sync()` de tentativa única por um *retry* com backoff. Isso não é opcional em Docker Compose: a imagem oficial do MySQL sobe um servidor temporário (só via socket Unix, sem rede) para rodar os scripts de inicialização, reporta *healthy* nesse estado, derruba esse servidor temporário e só então sobe o servidor definitivo com a rede habilitada — nesse intervalo, `depends_on: condition: service_healthy` já liberou o container da app, e uma tentativa única de `sync()` pode cair exatamente na janela em que a porta 3306 ainda está de pé caindo (`ECONNREFUSED`), deixando a tabela `tutorials` nunca criada. Isso foi reproduzido de verdade ao validar este guia (ver seção 4.1):

```js
function syncDbWithRetry(retriesLeft = 10, delayMs = 3000) {
  db.sequelize.sync()
    .then(() => {
      console.log("Synced db.");
    })
    .catch((err) => {
      console.log("Failed to sync db: " + err.message);
      if (retriesLeft > 0) {
        setTimeout(() => syncDbWithRetry(retriesLeft - 1, delayMs), delayMs);
      }
    });
}

syncDbWithRetry();
```

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

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

USER node

EXPOSE 8080

CMD ["node", "server.js"]
```

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
npm run test:smoke
```

Saída obtida ao validar este guia, rodando de verdade contra `docker compose up --build -d` (containers `app` e `mysql`, volume novo, sem atalhos):

```
PASS - GET / responds with welcome message
PASS - POST /api/tutorials creates a tutorial
PASS - GET /api/tutorials/:id retrieves the created tutorial
PASS - PUT /api/tutorials/:id updates the tutorial
PASS - DELETE /api/tutorials/:id removes the tutorial

All 5 checks passed.
```

O script termina com código de saída `1` se qualquer verificação falhar, permitindo uso em CI.

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

Depois dessas duas correções, `docker compose up --build -d` seguido de `npm run test:smoke` passou de forma limpa e repetida, inclusive a partir de um volume novo do zero — não é um resultado obtido "na primeira tentativa e nunca mais verificado".

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
