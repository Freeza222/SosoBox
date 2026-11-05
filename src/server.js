console.log(process.env.TMDB_TOKEN ? "Clé TMDB trouvée" : "Clé TMDB manquante");
const express = require("express");
const db = require("./db");
const multer = require("multer");
const upload = multer({ limits: { fileSize: 1024 * 1024 } }).single("avatar");
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
    ? db.prepare("SELECT id, username, avatar IS NOT NULL AS has_avatar FROM users WHERE id = ?").get(req.session.userId) || null
    : null;
    res.locals.chemin = req.path;
  next();
});

function copierFilm(film) {
  db.prepare("INSERT OR IGNORE INTO films (id, title, year, poster_path) VALUES (?, ?, ?, ?)")
    .run(film.id, film.title, Number((film.release_date || "").slice(0, 4)) || null, film.poster_path);
}

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/", async (req, res) => {
  const [populaires, mieuxNotes, auCinema] = await Promise.all([
  tmdb("/movie/popular?language=fr-FR&region=FR"),
  tmdb("/movie/top_rated?language=fr-FR"),
  tmdb("/movie/now_playing?language=fr-FR&region=FR"),
]);
  const fil = req.session.userId
    ? db.prepare(`SELECT u.username, f.id AS film_id, f.title, f.poster_path, r.rating, r.body
        FROM reviews r
        JOIN users u ON u.id = r.user_id
        JOIN films f ON f.id = r.film_id
        WHERE r.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?)
        ORDER BY r.id DESC LIMIT 20`).all(req.session.userId)
    : [];
  res.render("home", {
  fil,
  rangees: [
    { titre: "Populaires", films: populaires.results },
    { titre: "Les mieux notés", films: mieuxNotes.results },
    { titre: "Au cinéma", films: auCinema.results },
  ],
});
});

app.get("/search", async (req, res) => {
  const q = req.query.q || "";
  const fav = req.query.fav === "1" && !!req.session.userId;
  const onglet = req.query.onglet === "users" && !fav ? "users" : "films";
  const films = q && onglet === "films" ? (await tmdb("/search/movie?language=fr-FR&query=" + encodeURIComponent(q))).results : [];
  const gens = q && onglet === "users" ? db.prepare("SELECT username FROM users WHERE username LIKE ? LIMIT 20").all("%" + q + "%") : [];
  const deja = fav ? db.prepare("SELECT film_id FROM favorites WHERE user_id = ?").all(req.session.userId).map(r => r.film_id) : [];
  res.render("search", { q, films, gens, fav, deja, onglet });
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
  const favori = !!db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND film_id = ?").get(req.session.userId, film.id);
  const aVoir = !!(req.session.userId && db.prepare("SELECT 1 FROM watchlist WHERE user_id = ? AND film_id = ?")
  .get(req.session.userId, Number(req.params.id)));
  const monAvis = db.prepare("SELECT rating, body, watched_on FROM reviews WHERE user_id = ? AND film_id = ?")
  .get(req.session.userId, film.id);
  res.render("film", { film, avis, moy, favori, aVoir, monAvis });
});

app.use(["/login", "/register"], async (req, res, next) => {
  const data = await tmdb("/movie/popular?language=fr-FR&region=FR").catch(() => null);
  res.locals.affiches = data ? data.results.filter(f => f.poster_path) : [];
  next();
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
  copierFilm(film);
  db.prepare(`INSERT INTO reviews (user_id, film_id, rating, body, watched_on) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, film_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, watched_on = excluded.watched_on`)
    .run(req.session.userId, id, rating, req.body.body || "", req.body.watched_on || null);
      db.prepare("DELETE FROM watchlist WHERE user_id = ? AND film_id = ?").run(req.session.userId, id);
  res.redirect("/films/" + id);
});

app.get("/u/:username/avatar", (req, res) => {
  const u = db.prepare("SELECT avatar, avatar_type FROM users WHERE username = ?").get(req.params.username);
  if (!u) return res.status(404).send("Utilisateur introuvable");
  if (!u.avatar) return res.redirect("/avatar-defaut.svg");
  res.set("Content-Type", u.avatar_type);
  res.set("X-Content-Type-Options", "nosniff");
  res.send(u.avatar);
});

app.post("/pseudo", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const nouveau = (req.body.username || "").trim();
  if (nouveau.length < 3 || nouveau.length > 20) {
    return res.status(400).send("Le pseudo doit faire entre 3 et 20 caractères.");
  }
  const bio = (req.body.bio || "").trim().slice(0, 160) || null;
  try {
    db.prepare("UPDATE users SET username = ?, bio = ? WHERE id = ?").run(nouveau, bio, req.session.userId);
  } catch (e) {
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(400).send("Ce pseudo est déjà pris.");
    throw e;
  }
  res.redirect("/u/" + encodeURIComponent(nouveau));
});

app.get("/u/:username/films", (req, res) => {
  const profil = db.prepare("SELECT id, username FROM users WHERE username = ?").get(req.params.username);
  if (!profil) return res.status(404).send("Utilisateur introuvable");
  const films = db.prepare(`
    SELECT f.id, f.title, f.year, f.poster_path, r.rating
    FROM reviews r JOIN films f ON f.id = r.film_id
    WHERE r.user_id = ?
    ORDER BY r.watched_on DESC, r.id DESC
  `).all(profil.id);
  res.render("films-vus", { profil, films, titre: "Films vus par " + profil.username });
});

app.get("/u/:username/a-voir", (req, res) => {
  const profil = db.prepare("SELECT id, username FROM users WHERE username = ?").get(req.params.username);
  if (!profil) return res.status(404).send("Utilisateur introuvable");
  const films = db.prepare(`
    SELECT f.id, f.title, f.year, f.poster_path
    FROM watchlist w JOIN films f ON f.id = w.film_id
    WHERE w.user_id = ?
    ORDER BY w.created_at DESC
  `).all(profil.id);
  res.render("films-vus", { profil, films, titre: "Watchlist de " + profil.username });
});

app.get("/u/:username/stats", (req, res) => {
  const profil = db.prepare("SELECT id, username FROM users WHERE username = ?").get(req.params.username);
  if (!profil) return res.status(404).send("Utilisateur introuvable");

  const total = db.prepare("SELECT COUNT(*) AS n, AVG(rating) AS moy FROM reviews WHERE user_id = ?")
    .get(profil.id);

  const compte = Array(11).fill(0); // case 1 à 10 = demi-étoiles, comme rating
  for (const r of db.prepare("SELECT rating, COUNT(*) AS n FROM reviews WHERE user_id = ? GROUP BY rating").all(profil.id)) {
    compte[r.rating] = r.n;
  }

  const parAnnee = db.prepare(`
    SELECT substr(watched_on, 1, 4) AS annee, COUNT(*) AS n
    FROM reviews
    WHERE user_id = ? AND watched_on IS NOT NULL AND watched_on != ''
    GROUP BY annee ORDER BY annee DESC
  `).all(profil.id);

  res.render("stats", { profil, total, compte, parAnnee });
});

app.post("/avatar", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  upload(req, res, (err) => {
    const f = req.file;
    if (err || !f || !["image/jpeg", "image/png", "image/webp"].includes(f.mimetype)) {
      return res.status(400).send("Image invalide (JPG, PNG ou WebP, 1 Mo maximum)");
    }
    db.prepare("UPDATE users SET avatar = ?, avatar_type = ? WHERE id = ?").run(f.buffer, f.mimetype, req.session.userId);
    res.redirect("/u/" + encodeURIComponent(res.locals.user.username));
  });
});

app.get("/u/:username", async (req, res) => {
  const profil = db.prepare("SELECT id, username, bio, avatar IS NOT NULL AS has_avatar FROM users WHERE username = ?").get(req.params.username);
  if (!profil) return res.status(404).send("Utilisateur introuvable");
  const avis = db.prepare(`SELECT f.id, f.title, f.year, f.poster_path, r.rating
  FROM reviews r JOIN films f ON f.id = r.film_id
  WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 5`).all(profil.id);
  const total = db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE user_id = ?").get(profil.id).n;
  const suit = !!db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?").get(req.session.userId, profil.id);
  const abonnes = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE followed_id = ?").get(profil.id).n;
  const abonnements = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?").get(profil.id).n;
  const favoris = db.prepare(`SELECT f.id, f.title, f.poster_path FROM favorites fa
  JOIN films f ON f.id = fa.film_id WHERE fa.user_id = ? ORDER BY fa.id`).all(profil.id);

  let banniere = null;
  if (favoris.length > 0) {
    const f = await tmdb("/movie/" + favoris[0].id + "?language=fr-FR").catch(() => null);
    banniere = f && f.backdrop_path;
  }

  res.render("profile", { profil, avis, suit, abonnes, abonnements, favoris, total, banniere });
});

app.post("/films/:id/review/delete", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const id = Number(req.params.id);
  db.prepare("DELETE FROM reviews WHERE user_id = ? AND film_id = ?").run(req.session.userId, id);
  res.redirect("/films/" + id);
});

app.post("/u/:username/follow", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const cible = db.prepare("SELECT id FROM users WHERE username = ?").get(req.params.username);
  if (!cible || cible.id === req.session.userId) return res.status(400).send("Impossible");
  const del = db.prepare("DELETE FROM follows WHERE follower_id = ? AND followed_id = ?").run(req.session.userId, cible.id);
  if (del.changes === 0) {
    db.prepare("INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)").run(req.session.userId, cible.id);
  }
  res.redirect("/u/" + encodeURIComponent(req.params.username));
});

app.get("/u/:username/:liste", (req, res) => {
  const { username, liste } = req.params;
  if (liste !== "abonnes" && liste !== "abonnements") return res.status(404).send("Page introuvable");
  const profil = db.prepare("SELECT id, username FROM users WHERE username = ?").get(username);
  if (!profil) return res.status(404).send("Utilisateur introuvable");
  const sql = liste === "abonnes"
    ? "SELECT u.username FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followed_id = ? ORDER BY f.created_at DESC"
    : "SELECT u.username FROM follows f JOIN users u ON u.id = f.followed_id WHERE f.follower_id = ? ORDER BY f.created_at DESC";
  const gens = db.prepare(sql).all(profil.id);
  res.render("people", { profil, liste, gens });
});

app.post("/films/:id/favori", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).send("Film invalide");
  const del = db.prepare("DELETE FROM favorites WHERE user_id = ? AND film_id = ?").run(req.session.userId, id);
  if (del.changes === 0) {
    const n = db.prepare("SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?").get(req.session.userId).n;
    if (n >= 4) return res.status(400).send("4 films favoris maximum : retire-en un d'abord.");
    let film;
    try {
      film = await tmdb("/movie/" + id + "?language=fr-FR");
    } catch {
      return res.status(404).send("Film introuvable");
    }
    copierFilm(film);
    db.prepare("INSERT INTO favorites (user_id, film_id) VALUES (?, ?)").run(req.session.userId, id);
  }
  res.redirect(req.body.retour === "profil" ? "/u/" + encodeURIComponent(res.locals.user.username) : "/films/" + id);
});

app.post("/favoris/echanger", (req, res) => {
  if (!req.session.userId) return res.status(401).end();
  const trouver = db.prepare("SELECT id FROM favorites WHERE user_id = ? AND film_id = ?");
  const a = trouver.get(req.session.userId, Number(req.body.a));
  const b = trouver.get(req.session.userId, Number(req.body.b));
  if (!a || !b || a.id === b.id) return res.status(400).end();

  const changerId = db.prepare("UPDATE favorites SET id = ? WHERE id = ?");
  db.transaction(() => {
    changerId.run(-a.id, a.id); // tmp = a
    changerId.run(a.id, b.id);  // a = b
    changerId.run(b.id, -a.id); // b = tmp
  })();
  res.end();
});

app.post("/films/:id/a-voir", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const filmId = Number(req.params.id);
  if (!Number.isInteger(filmId)) return res.status(404).send("Film introuvable");

  const suppr = db.prepare("DELETE FROM watchlist WHERE user_id = ? AND film_id = ?")
    .run(req.session.userId, filmId);
  if (suppr.changes === 0) {
    // copie locale du film, comme pour les favoris
    const f = await tmdb("/movie/" + filmId + "?language=fr-FR");
    db.prepare("INSERT OR IGNORE INTO films (id, title, year, poster_path) VALUES (?, ?, ?, ?)")
      .run(f.id, f.title, (f.release_date || "").slice(0, 4), f.poster_path);
    db.prepare("INSERT INTO watchlist (user_id, film_id) VALUES (?, ?)")
      .run(req.session.userId, filmId);
  }
  res.redirect("/films/" + filmId);
});

app.get("/api/suggestions", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  const data = await tmdb("/search/movie?language=fr-FR&query=" + encodeURIComponent(q));
  const films = data.results
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 3)
    .map(f => ({ id: f.id, title: f.title, year: (f.release_date || "").slice(0, 4), poster: f.poster_path }));
  res.json(films);
});

app.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});
