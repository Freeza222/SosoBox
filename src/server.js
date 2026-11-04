console.log(process.env.TMDB_TOKEN ? "Clé TMDB trouvée" : "Clé TMDB manquante");
const express = require("express");
const db = require("./db");
const bcrypt = require("bcrypt");
const { tmdb } = require("./tmdb");
const session = require("express-session");
const app = express();


app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));

app.use((req, res, next) => {
  res.locals.user = req.session.userId
    ? db.prepare("SELECT id, username FROM users WHERE id = ?").get(req.session.userId) || null
    : null;
  next();
});
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

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
  let film;
  try {
    film = await tmdb("/movie/" + encodeURIComponent(req.params.id) + "?language=fr-FR&append_to_response=credits");
  } catch {
    return res.status(404).send("Film introuvable");
  }
  const avis = db.prepare(`SELECT u.username, r.rating, r.body, r.watched_on
    FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.film_id = ? ORDER BY r.id DESC`).all(film.id);
  const moy = db.prepare("SELECT AVG(rating) AS m FROM reviews WHERE film_id = ?").get(film.id).m;
  res.render("film", { film, avis, moy });
});


app.get("/register", (req, res) => res.render("register", { erreur: null }));

app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password || password.length < 8) {
    return res.status(400).render("register", { erreur: "Tous les champs sont requis, mot de passe de 8 caractères minimum." });
  }
  const hash = await bcrypt.hash(password, 10);
    let info;
  try {
    info = db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)").run(username, email, hash);
  } catch {
    return res.status(400).render("register", { erreur: "Pseudo ou e-mail déjà utilisé." });
  }
  req.session.userId = info.lastInsertRowid;
  res.redirect("/");
});
app.get("/login", (req, res) => res.render("login", { erreur: null }));

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username || "");
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
    return res.status(401).render("login", { erreur: "Pseudo ou mot de passe incorrect." });
  }
  req.session.userId = user.id;
  res.redirect("/");
});

app.post("/films/:id/review", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const id = Number(req.params.id);
  const rating = Number(req.body.rating);
  if (!Number.isInteger(id) || !Number.isInteger(rating) || rating < 1 || rating > 10) {
    return res.status(400).send("Note invalide");
  }
  let film;
  try {
    film = await tmdb("/movie/" + id + "?language=fr-FR");
  } catch {
    return res.status(404).send("Film introuvable");
  }
  db.prepare("INSERT OR IGNORE INTO films (id, title, year, poster_path) VALUES (?, ?, ?, ?)")
    .run(film.id, film.title, Number((film.release_date || "").slice(0, 4)) || null, film.poster_path);
  db.prepare(`INSERT INTO reviews (user_id, film_id, rating, body, watched_on) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, film_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, watched_on = excluded.watched_on`)
    .run(req.session.userId, id, rating, req.body.body || "", req.body.watched_on || null);
  res.redirect("/films/" + id);
});

app.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});