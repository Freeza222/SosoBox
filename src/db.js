const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const db = new Database("sosobox.db");
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

module.exports = db;
