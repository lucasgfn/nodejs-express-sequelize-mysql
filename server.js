require("dotenv").config();

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
      console.log("Failed to sync db: " + err.message);
      if (retriesLeft > 0) {
        setTimeout(() => syncDbWithRetry(retriesLeft - 1, delayMs), delayMs);
      }
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
