console.log(process.env.TMDB_TOKEN ? "Clé TMDB trouvée" : "Clé TMDB manquante");
const express = require("express");
const db = require("./db");
const multer = require("multer");
const upload = multer({ limits: { fileSize: 1024 * 1024 } }).single("avatar");
const bcrypt = require("bcrypt");
const { tmdb } = require("./tmdb");
const session = require("express-session");
const app = express();
app.set("trust proxy", 1);

// Sessions rangées dans SQLite : elles survivent aux redémarrages
db.exec("CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expire INTEGER NOT NULL)");
try { db.exec("ALTER TABLE favorites ADD COLUMN poster_path TEXT"); } catch {} // affiche choisie, NULL = celle par défaut
db.prepare("DELETE FROM sessions WHERE expire < ?").run(Date.now()); // ménage au démarrage

class SqliteStore extends session.Store {
  get(sid, cb) {
    try {
      const ligne = db.prepare("SELECT data FROM sessions WHERE sid = ? AND expire > ?").get(sid, Date.now());
      cb(null, ligne ? JSON.parse(ligne.data) : null);
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      // cookie avec date : on garde jusqu'à cette date ; sinon 1 jour suffit
      const expire = sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 24 * 60 * 60 * 1000;
      db.prepare(`INSERT INTO sessions (sid, data, expire) VALUES (?, ?, ?)
                  ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expire = excluded.expire`)
        .run(sid, JSON.stringify(sess), expire);
      cb(null);
    } catch (e) { cb(e); }
  }
  destroy(sid, cb) {
    try {
      db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      cb(null);
    } catch (e) { cb(e); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); } // prolonge la date quand tu reviens
}

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new SqliteStore(),
  secret: process.env.SESSION_SECRET, cookie: { secure: process.env.NODE_ENV === "production", sameSite: "lax" },
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
  const fil = req.session.userId ? db.prepare(`
    SELECT u.username, r.film_id, r.rating, r.body, f.title, f.poster_path
    FROM reviews r
    JOIN follows fo ON fo.followed_id = r.user_id
    JOIN users u ON u.id = r.user_id
    JOIN films f ON f.id = r.film_id
    WHERE fo.follower_id = ?
    ORDER BY r.id DESC LIMIT 20
  `).all(req.session.userId) : [];

  const RANGEES = [
    ["Tendances de la semaine", "/trending/movie/week?language=fr-FR"],
    ["Populaires", "/movie/popular?language=fr-FR&region=FR"],
    ["Au cinéma", "/movie/now_playing?language=fr-FR&region=FR"],
    ["Bientôt au cinéma", "/movie/upcoming?language=fr-FR&region=FR"],
    ["Les mieux notés", "/movie/top_rated?language=fr-FR"],
    ["Action", "/discover/movie?language=fr-FR&sort_by=popularity.desc&with_genres=28"],
    ["Comédie", "/discover/movie?language=fr-FR&sort_by=popularity.desc&with_genres=35"],
    ["Horreur", "/discover/movie?language=fr-FR&sort_by=popularity.desc&with_genres=27"],
    ["Science-Fiction", "/discover/movie?language=fr-FR&sort_by=popularity.desc&with_genres=878"],
    ["Animation", "/discover/movie?language=fr-FR&sort_by=popularity.desc&with_genres=16"],
  ];

  const rangees = await Promise.all(RANGEES.map(async ([titre, chemin]) => {
    const data = await tmdb(chemin).catch(() => null);
    return { titre, films: data ? data.results : [] };
  }));

  const plusVus = db.prepare(`
    SELECT f.id, f.title, f.poster_path, COUNT(*) AS n
    FROM reviews r JOIN films f ON f.id = r.film_id
    GROUP BY f.id ORDER BY n DESC, AVG(r.rating) DESC LIMIT 20
  `).all();
  if (plusVus.length > 0) rangees.splice(1, 0, { titre: "Les plus vus sur SosoBox", films: plusVus });

  res.render("home", { fil, rangees: rangees.filter(r => r.films.length > 0) });
});

app.get("/search", async (req, res) => {
  const q = req.query.q || "";
  const fav = req.query.fav === "1" && !!req.session.userId;
  const onglet = req.query.onglet === "users" && !fav ? "users" : "films";
  const films = q && onglet === "films" ? (await tmdb("/search/movie?language=fr-FR&query=" + encodeURIComponent(q))).results : [];
  const gens = q && onglet === "users" ? db.prepare("SELECT username FROM users WHERE username LIKE ? LIMIT 20").all("%" + q + "%") : [];
  const deja = fav ? db.prepare("SELECT film_id FROM favorites WHERE user_id = ?").all(req.session.userId).map(r => r.film_id) : [];
    let genres = [], tendances = [], genreChoisi = null, genreFilms = [];
  if (!q) {
    const [g, t] = await Promise.all([
      tmdb("/genre/movie/list?language=fr-FR"),
      tmdb("/trending/movie/week?language=fr-FR"),
    ]);
    const GENRES = [28, 35, 18, 27, 878, 16];
    genres = await Promise.all(
      GENRES.map(id => g.genres.find(x => x.id === id)).filter(Boolean).map(async x => {
        const d = await tmdb("/discover/movie?language=fr-FR&sort_by=vote_count.desc&with_genres=" + x.id).catch(() => null); // les plus votés = les classiques
        const affiches = d ? d.results.filter(f => f.poster_path).slice(0, 3).map(f => f.poster_path) : [];
        return { ...x, affiches };
      })
    );
    tendances = t.results;
    genreChoisi = genres.find(x => x.id === Number(req.query.genre)) || null;
        if (genreChoisi) {
      const url = "/discover/movie?language=fr-FR&sort_by=vote_count.desc&with_genres=" + genreChoisi.id + "&page=";
      const pages = await Promise.all([1, 2].map(p => tmdb(url + p).catch(() => null)));
      genreFilms = pages.flatMap(d => (d ? d.results : [])).slice(0, 35);
    }
  }
  res.render("search", { q, onglet, fav, films, gens, genres, tendances, genreChoisi, genreFilms });
});

app.get("/films/:id", async (req, res) => {
  let film;
  try {
    film = await tmdb("/movie/" + encodeURIComponent(req.params.id) + "?language=fr-FR&append_to_response=credits");
  } catch {
    return res.status(404).send("Film introuvable");
  }
  if (film.adult) return res.status(404).send("Film introuvable");
  const avis = db.prepare(`SELECT u.username, r.rating, r.body, r.watched_on
    FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.film_id = ? ORDER BY r.id DESC`).all(film.id);
  const moy = db.prepare("SELECT AVG(rating) AS m FROM reviews WHERE film_id = ?").get(film.id).m;
  const favori = !!db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND film_id = ?").get(req.session.userId, film.id);
  const aVoir = !!(req.session.userId && db.prepare("SELECT 1 FROM watchlist WHERE user_id = ? AND film_id = ?")
  .get(req.session.userId, Number(req.params.id)));
  const monAvis = db.prepare("SELECT rating, body, watched_on FROM reviews WHERE user_id = ? AND film_id = ?")
  .get(req.session.userId, film.id);
  const nbFavoris = db.prepare("SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?").get(req.session.userId).n;
    const repartition = Array(11).fill(0); // cases 1 à 10 = demi-étoiles
  for (const r of db.prepare("SELECT rating, COUNT(*) AS n FROM reviews WHERE film_id = ? GROUP BY rating").all(film.id)) {
    repartition[r.rating] = r.n;
  }
  const maxRep = Math.max(1, ...repartition);

  const amis = db.prepare(`
    SELECT u.username, r.rating
    FROM reviews r
    JOIN follows fo ON fo.followed_id = r.user_id
    JOIN users u ON u.id = r.user_id
    WHERE fo.follower_id = ? AND r.film_id = ?
    ORDER BY r.id DESC LIMIT 5
  `).all(req.session.userId, film.id);
  res.render("film", { film, avis, moy, favori, aVoir, monAvis, nbFavoris, repartition, maxRep, amis });
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

const essais = new Map();
const FENETRE = 15 * 60 * 1000;
function tropDEssais(ip) {
  const e = essais.get(ip);
  return !!e && Date.now() - e.debut < FENETRE && e.n >= 5;
}

function noterEchec(ip) {
  const e = essais.get(ip);
  if (!e || Date.now() - e.debut >= FENETRE) essais.set(ip, { n: 1, debut: Date.now() });
  else e.n++;
}

app.post("/login", async (req, res) => {
    if (tropDEssais(req.ip)) {
    return res.status(429).render("login", { erreur: "Trop de tentatives. Réessaie dans 15 minutes." });
  }
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username || "");
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
    noterEchec(req.ip);
    return res.status(401).render("login", { erreur: "Pseudo ou mot de passe incorrect." });
  }
  essais.delete(req.ip);
  req.session.userId = user.id;
  if (req.body.rester) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
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
  const journal = db.prepare(`
    SELECT f.id, f.title, f.poster_path, r.rating, r.watched_on
    FROM reviews r JOIN films f ON f.id = r.film_id
    WHERE r.user_id = ? AND r.watched_on IS NOT NULL AND r.watched_on != ''
    ORDER BY r.watched_on DESC, r.id DESC LIMIT 12
  `).all(profil.id);
  const total = db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE user_id = ?").get(profil.id).n;
  const suit = !!db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?").get(req.session.userId, profil.id);
  const abonnes = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE followed_id = ?").get(profil.id).n;
  const abonnements = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?").get(profil.id).n;
  const favoris = db.prepare(`SELECT f.id, f.title, COALESCE(fa.poster_path, f.poster_path) AS poster_path FROM favorites fa
  JOIN films f ON f.id = fa.film_id WHERE fa.user_id = ? ORDER BY fa.id`).all(profil.id);

  let banniere = null;
  if (favoris.length > 0) {
    const f = await tmdb("/movie/" + favoris[0].id + "?language=fr-FR").catch(() => null);
    banniere = f && f.backdrop_path;
  }

  res.render("profile", { profil, journal, suit, abonnes, abonnements, favoris, total, banniere });
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
  const retour = req.body.retour || "";
  const retourOk = /^\/u\/[^/]+\/(abonnes|abonnements)$/.test(retour); // liste blanche
  res.redirect(retourOk ? retour : "/u/" + encodeURIComponent(req.params.username));
});

app.get("/u/:username/:liste", (req, res) => {
  const { username, liste } = req.params;
  if (liste !== "abonnes" && liste !== "abonnements") return res.status(404).send("Page introuvable");
  const profil = db.prepare("SELECT id, username FROM users WHERE username = ?").get(username);
  if (!profil) return res.status(404).send("Utilisateur introuvable");
  const sql = liste === "abonnes"
    ? `SELECT u.id, u.username,
         (SELECT COUNT(*) FROM reviews r WHERE r.user_id = u.id) AS films,
         EXISTS (SELECT 1 FROM follows x WHERE x.follower_id = ? AND x.followed_id = u.id) AS suivi
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.followed_id = ? ORDER BY f.created_at DESC`
    : `SELECT u.id, u.username,
         (SELECT COUNT(*) FROM reviews r WHERE r.user_id = u.id) AS films,
         EXISTS (SELECT 1 FROM follows x WHERE x.follower_id = ? AND x.followed_id = u.id) AS suivi
       FROM follows f JOIN users u ON u.id = f.followed_id
       WHERE f.follower_id = ? ORDER BY f.created_at DESC`;
  const gens = db.prepare(sql).all(req.session.userId ?? 0, profil.id); // 0 = pas connecté : suivi vaut 0
  const nbAbonnes = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE followed_id = ?").get(profil.id).n;
  const nbAbonnements = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?").get(profil.id).n;
  res.render("people", { profil, liste, gens, nbAbonnes, nbAbonnements });
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

app.get("/favoris/:id/affiche", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const id = Number(req.params.id);
  const fav = db.prepare(`SELECT f.id, f.title, COALESCE(fa.poster_path, f.poster_path) AS actuelle
    FROM favorites fa JOIN films f ON f.id = fa.film_id
    WHERE fa.user_id = ? AND fa.film_id = ?`).get(req.session.userId, id);
  if (!fav) return res.status(404).send("Ce film n'est pas dans ton top 4");
  const data = await tmdb("/movie/" + id + "/images?include_image_language=fr,en,null").catch(() => null);
  const affiches = data ? data.posters.slice(0, 40).map(p => p.file_path) : [];
  res.render("affiche", { fav, affiches });
});

app.post("/favoris/:id/affiche", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const poster = req.body.poster || "";
  if (!/^\/[A-Za-z0-9]+\.(jpg|png)$/.test(poster)) return res.status(400).send("Affiche invalide");
  db.prepare("UPDATE favorites SET poster_path = ? WHERE user_id = ? AND film_id = ?")
    .run(poster, req.session.userId, Number(req.params.id));
  res.redirect("/u/" + encodeURIComponent(res.locals.user.username));
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Serveur lancé sur http://localhost:" + PORT));