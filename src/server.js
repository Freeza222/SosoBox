console.log(process.env.TMDB_TOKEN ? "Clé TMDB trouvée" : "Clé TMDB manquante");
const express = require("express");
const db = require("./db");
const bcrypt = require("bcrypt");
const { tmdb } = require("./tmdb");
const app = express();
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: false }));


app.get("/", async (req, res) => {
  const { results } = await tmdb("/movie/popular?language=fr-FR");
  res.render("home", { films: results });
});

app.get("/search", async (req, res) => {
  const q = req.query.q || "";
  const films = q ? (await tmdb("/search/movie?language=fr-FR&query=" + encodeURIComponent(q))).results : [];
  res.render("search", { q, films });
});


app.get("/films/:id", async (req, res) => {
  try {
    const film = await tmdb("/movie/" + encodeURIComponent(req.params.id) + "?language=fr-FR&append_to_response=credits");
    res.render("film", { film });
  } catch {
    res.status(404).send("Film introuvable");
  }
});


app.get("/register", (req, res) => res.render("register", { erreur: null }));

app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password || password.length < 8) {
    return res.status(400).render("register", { erreur: "Tous les champs sont requis, mot de passe de 8 caractères minimum." });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)").run(username, email, hash);
  } catch {
    return res.status(400).render("register", { erreur: "Pseudo ou e-mail déjà utilisé." });
  }
  res.redirect("/");
});


app.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});