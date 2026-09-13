require("dotenv").config();

//Garantido que subirá na porta correta e não em uma aleatório sem o uso do env
const REQUIRED_ENV = [
  "PORT",
  "CORS_ORIGIN",
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME"
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

const express = require("express");
const cors = require("cors");

const app = express();

var corsOptions = {
  origin: process.env.CORS_ORIGIN
};

app.use(cors(corsOptions));

// parse requests of content-type - application/json
app.use(express.json());

// parse requests of content-type - application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

const db = require("./app/models");

// Função para tentar sincronizar o banco de dados (Sequelize) com retry automatico caso falhe
function syncDbWithRetry(retriesLeft = 10, delayMs = 3000) {
  db.sequelize.sync()
    .then(() => {
      console.log("Synced db.");
    })
    .catch((err) => {
      console.error("Failed to sync db: " + err.message);
      if (retriesLeft > 0) {
        console.error(
          `Nova tentativa em ${delayMs}ms (${retriesLeft} restantes).`
        );
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

// // drop the table if it already exists
// db.sequelize.sync({ force: true }).then(() => {
//   console.log("Drop and re-sync db.");
// });

// simple route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to bezkoder application." });
});

require("./app/routes/turorial.routes")(app);

// set port, listen for requests
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}.`);
});
