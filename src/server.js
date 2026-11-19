console.log(process.env.TMDB_TOKEN ? "Clé TMDB trouvée" : "Clé TMDB manquante");
const express = require("express");
const db = require("./db");
const multer = require("multer");
const upload = multer({ limits: { fileSize: 1024 * 1024 } }).single("avatar");
const bcrypt = require("bcrypt");
const { tmdb } = require("./tmdb");
const { lireCsv } = require("./csv");
const uploadCsv = multer({ limits: { fileSize: 5 * 1024 * 1024 } })
.fields([{ name: "fichier", maxCount: 1 }, { name: "journal", maxCount: 1 }]);
const session = require("express-session");
const app = express();
const aujourdhui = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
app.locals.aujourdhui = aujourdhui;
const { annee, comparer, INDICES } = require("./jour");
app.set("trust proxy", 1);

db.exec("CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expire INTEGER NOT NULL)");
try { db.exec("ALTER TABLE favorites ADD COLUMN poster_path TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"); } catch {}
db.exec(`CREATE TABLE IF NOT EXISTS acteurs_favoris (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  person_id INTEGER NOT NULL,
  nom TEXT NOT NULL,
  photo TEXT,
  UNIQUE (user_id, person_id)
)`);
try { db.exec("ALTER TABLE users ADD COLUMN notif_vu_at TEXT"); db.exec("UPDATE users SET notif_vu_at = datetime('now')"); } catch {}
try { db.exec("ALTER TABLE reviews ADD COLUMN created_at TEXT"); } catch {}
try { db.exec("ALTER TABLE jour_essais ADD COLUMN cases TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN banniere_x REAL NOT NULL DEFAULT 50"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN banniere_y REAL NOT NULL DEFAULT 25"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN banniere_zoom REAL NOT NULL DEFAULT 100"); } catch {}
try { db.exec("ALTER TABLE reviews ADD COLUMN revu INTEGER NOT NULL DEFAULT 0"); } catch {}
db.prepare("DELETE FROM sessions WHERE expire < ?").run(Date.now());

// Journal : un visionnage = une ligne (un film revu plusieurs fois = plusieurs lignes)
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'visionnages'").get()) {
  db.exec(`CREATE TABLE visionnages (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    film_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    watched_on TEXT NOT NULL,
    revu INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, film_id, watched_on)
  )`);
  // la toute première fois : on recopie les dates déjà présentes dans les avis
  db.exec(`INSERT OR IGNORE INTO visionnages (user_id, film_id, rating, watched_on)
    SELECT user_id, film_id, rating, watched_on FROM reviews WHERE watched_on IS NOT NULL AND watched_on != ''`);
}

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
    ? db.prepare("SELECT id, username, avatar IS NOT NULL AS has_avatar, is_admin FROM users WHERE id = ?").get(req.session.userId) || null
    : null;
    res.locals.chemin = req.path;
  res.locals.nbNotifs = res.locals.user ? db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM follows f WHERE f.followed_id = @me AND f.created_at > IFNULL(u.notif_vu_at, ''))
      + (SELECT COUNT(*) FROM reviews r JOIN follows fo ON fo.followed_id = r.user_id AND fo.follower_id = @me
         WHERE r.created_at > fo.created_at AND r.created_at > IFNULL(u.notif_vu_at, '')) AS n
    FROM users u WHERE u.id = @me`).get({ me: res.locals.user.id }).n : 0;
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
    ORDER BY r.created_at DESC, r.id DESC LIMIT 5
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
  const promesseClassiques = tmdb("/discover/movie?language=fr-FR&sort_by=vote_count.desc").catch(() => null);
  const rangees = await Promise.all(RANGEES.map(async ([titre, chemin]) => {
    const data = await tmdb(chemin).catch(() => null);
    return { titre, films: data ? data.results : [] };
  }));
  const affiches = films => films.filter(f => f.poster_path).map(f => f.poster_path);
  const bandeHaut = affiches(rangees[0].films);                          // tendances de la semaine
  const bandeBas = affiches(((await promesseClassiques) || {}).results || []); // classiques

  const plusVus = db.prepare(`
    SELECT f.id, f.title, f.poster_path, COUNT(*) AS n
    FROM reviews r JOIN films f ON f.id = r.film_id
    GROUP BY f.id ORDER BY n DESC, AVG(r.rating) DESC LIMIT 20
  `).all();
  if (plusVus.length > 0) rangees.splice(1, 0, { titre: "Les plus vus sur SosoBox", films: plusVus });

  const jourEtat = req.session.userId
    ? db.prepare("SELECT COUNT(*) AS essais, MAX(temp) = 100 AS trouve FROM jour_essais WHERE user_id = ? AND jour = ?")
        .get(req.session.userId, aujourdhui())
    : null;
    res.render("home", { fil, rangees: rangees.filter(r => r.films.length > 0), bandeHaut, bandeBas, jourEtat });
  });

app.get("/search", async (req, res) => {
  const q = req.query.q || "";
  const fav = req.query.fav === "1" && !!req.session.userId;
  const onglet = !fav && ["users", "artistes"].includes(req.query.onglet) ? req.query.onglet : "films";
    const MIN_VOTES = 20; // en dessous : making-of, fiches vides, projets inconnus
  let films = [];
  if (q && onglet === "films") {
    const brut = (await tmdb("/search/movie?language=fr-FR&query=" + encodeURIComponent(q))).results.filter(f => f.poster_path);
    const connus = brut.filter(f => f.vote_count >= MIN_VOTES);
    films = connus.length ? connus : brut; // si rien de connu, on garde tout : un film très rare reste trouvable
  }
  const gens = q && onglet === "users" ? db.prepare("SELECT username FROM users WHERE username LIKE ? LIMIT 20").all("%" + q + "%") : [];
  let artistes = [];
  if (q && onglet === "artistes") {
    const METIERS = { Acting: ["Acteur", "Actrice"], Directing: ["Réalisateur", "Réalisatrice"], Writing: ["Scénariste", "Scénariste"] };
    const data = await tmdb("/search/person?language=fr-FR&query=" + encodeURIComponent(q)).catch(() => null);
    const candidats = (data ? data.results : []).filter(p => p.profile_path && !p.adult && METIERS[p.known_for_department]);
    // les acteurs passent la vérification de filmographie ; les autres, seulement la liste noire
    const oks = await Promise.all(candidats.map(p => p.known_for_department === "Acting" ? vraiActeur(p) : !BANNIS.has(p.id)));
    artistes = candidats.filter((_, i) => oks[i])
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 20)
      .map(p => ({
        id: p.id,
        nom: p.name,
        photo: p.profile_path,
        metier: METIERS[p.known_for_department][p.gender === 1 ? 1 : 0],
        connu: (p.known_for || []).map(f => f.title || f.name).filter(Boolean).slice(0, 3).join(", "),
      }));
  }
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
  res.render("search", { q, onglet, fav, deja, films, gens, artistes, genres, tendances, genreChoisi, genreFilms });
});

app.get("/notifications", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const me = req.session.userId;
  const vu = db.prepare("SELECT IFNULL(notif_vu_at, '') AS v FROM users WHERE id = ?").get(me).v;
  const abonnes = db.prepare(`
  SELECT u.username, f.created_at > ? AS nouveau,
    EXISTS (SELECT 1 FROM follows x WHERE x.follower_id = ? AND x.followed_id = f.follower_id) AS je_suis
  FROM follows f JOIN users u ON u.id = f.follower_id
  WHERE f.followed_id = ? ORDER BY f.created_at DESC LIMIT 20`).all(vu, me, me);
  const avis = db.prepare(`
    SELECT u.username, r.film_id, r.rating, f.title, r.created_at > ? AS nouveau
    FROM reviews r
    JOIN follows fo ON fo.followed_id = r.user_id AND fo.follower_id = ?
    JOIN users u ON u.id = r.user_id
    JOIN films f ON f.id = r.film_id
    WHERE r.created_at > fo.created_at
    ORDER BY r.created_at DESC LIMIT 20`).all(vu, me);
  db.prepare("UPDATE users SET notif_vu_at = datetime('now') WHERE id = ?").run(me);
  res.locals.nbNotifs = 0;
  res.render("notifications", { abonnes, avis });
});

app.get("/films/:id", async (req, res) => {
  let film;
  try {
    film = await tmdb("/movie/" + encodeURIComponent(req.params.id) + "?language=fr-FR&append_to_response=credits,watch/providers");
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
  const monAvis = db.prepare("SELECT rating, body, watched_on, revu FROM reviews WHERE user_id = ? AND film_id = ?")
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
  const vu = req.body.watched_on || null;
  if (vu && (!/^\d{4}-\d{2}-\d{2}$/.test(vu) || vu < "1900-01-01" || vu > aujourdhui())) {
    return res.status(400).send("Date invalide : elle ne peut pas être dans le futur.");
  }
  let film;
  try {
    film = await tmdb("/movie/" + id + "?language=fr-FR");
  } catch {
    return res.status(404).send("Film introuvable");
  }
  copierFilm(film);
  const revu = req.body.revu ? 1 : 0; // case cochée = "revu" envoyé ; décochée = rien d'envoyé
  db.prepare(`INSERT INTO reviews (user_id, film_id, rating, body, watched_on, revu, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (user_id, film_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, watched_on = excluded.watched_on, revu = excluded.revu`)
      .run(req.session.userId, id, rating, req.body.body || "", vu, revu);
        if (vu) {
    const me = req.session.userId;
    if (revu) {
      // revisionnage : une NOUVELLE ligne dans le journal (même jour = on met juste la note à jour)
      db.prepare(`INSERT INTO visionnages (user_id, film_id, rating, watched_on, revu) VALUES (?, ?, ?, ?, 1)
        ON CONFLICT (user_id, film_id, watched_on) DO UPDATE SET rating = excluded.rating, revu = 1`).run(me, id, rating, vu);
    } else {
      // simple correction : on modifie le dernier visionnage de ce film (ou on le crée)
      const dernier = db.prepare("SELECT id FROM visionnages WHERE user_id = ? AND film_id = ? ORDER BY watched_on DESC LIMIT 1").get(me, id);
      if (dernier) db.prepare("UPDATE OR IGNORE visionnages SET rating = ?, watched_on = ? WHERE id = ?").run(rating, vu, dernier.id);
      else db.prepare("INSERT OR IGNORE INTO visionnages (user_id, film_id, rating, watched_on) VALUES (?, ?, ?, ?)").run(me, id, rating, vu);
    }
  }
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
    FROM visionnages
    WHERE user_id = ?
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

app.post("/banniere/cadrage", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  // ces nombres finissent dans un style="…" : on n'accepte QUE des nombres, bornés
  const borne = (v, min, max, defaut) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut; };
  db.prepare("UPDATE users SET banniere_x = ?, banniere_y = ?, banniere_zoom = ? WHERE id = ?")
    .run(borne(req.body.x, 0, 100, 50), borne(req.body.y, 0, 100, 25), borne(req.body.zoom, 100, 250, 100), req.session.userId);
  res.redirect("/u/" + encodeURIComponent(res.locals.user.username));
});

app.get("/import", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  res.render("import", { bilan: null, erreur: null });
});

app.post("/import", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  uploadCsv(req, res, async (err) => {
    const fichier = req.files?.fichier?.[0];
    if (err || !fichier) return res.render("import", { bilan: null, erreur: "Fichier manquant ou trop gros (5 Mo maximum)." });
    const vus = new Map();
    const journal = req.files?.journal?.[0];
    if (journal) {
      for (const d of lireCsv(journal.buffer.toString("utf8"))) {
        const date = d["Watched Date"], cle = d.Name + "|" + d.Year;
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= aujourdhui() && !(vus.get(cle) >= date)) vus.set(cle, date);
      }
    }

    const lignes = lireCsv(fichier.buffer.toString("utf8"))
      .filter(l => l.Name && Number(l.Rating) > 0)
      .slice(0, 3000)
      .map(l => ({
        titre: l.Name,
        annee: /^\d{4}$/.test(l.Year) ? l.Year : "",
        note: Math.round(Number(l.Rating) * 2),
        date: /^\d{4}-\d{2}-\d{2}$/.test(l.Date) && l.Date <= aujourdhui() ? l.Date : aujourdhui(),
        vu: vus.get(l.Name + "|" + l.Year)
          || (/^\d{4}-\d{2}-\d{2}$/.test(l["Watched Date"]) && l["Watched Date"] <= aujourdhui() ? l["Watched Date"] : null),                
      }));
    if (lignes.length === 0) return res.render("import", { bilan: null, erreur: "Aucun film noté trouvé : envoie bien le fichier ratings.csv." });

    const me = req.session.userId;
    const ajouter = db.prepare(`INSERT INTO reviews (user_id, film_id, rating, body, watched_on, created_at)
      VALUES (?, ?, ?, '', ?, ?) ON CONFLICT (user_id, film_id) DO NOTHING`);
    const ajouterDate = db.prepare(`UPDATE reviews SET watched_on = ?
      WHERE user_id = ? AND film_id = ? AND (watched_on IS NULL OR watched_on = '')`);
    const retirerAVoir = db.prepare("DELETE FROM watchlist WHERE user_id = ? AND film_id = ?");
    const ajouterVision = db.prepare("INSERT OR IGNORE INTO visionnages (user_id, film_id, rating, watched_on) VALUES (?, ?, ?, ?)");
    const bilan = { ajoutes: 0, deja: 0, dates: 0, introuvables: [] };

    for (let i = 0; i < lignes.length; i += 10) {
      await Promise.all(lignes.slice(i, i + 10).map(async l => {
        const r = await tmdb("/search/movie?language=fr-FR&query=" + encodeURIComponent(l.titre) + (l.annee ? "&year=" + l.annee : "")).catch(() => null);
        const film = r && r.results[0];
        if (!film) return bilan.introuvables.push(l);
        copierFilm(film);
        if (ajouter.run(me, film.id, l.note, l.vu, l.date).changes) {
          bilan.ajoutes++;
          if (l.vu) bilan.dates++;
        } else {
          bilan.deja++;
          if (l.vu && ajouterDate.run(l.vu, me, film.id).changes) bilan.dates++;
        }
        if (l.vu) ajouterVision.run(me, film.id, l.note, l.vu);
        retirerAVoir.run(me, film.id);
      }));
    }
    res.render("import", { bilan, erreur: null });
  });
});

app.get("/u/:username", async (req, res) => {
  const profil = db.prepare("SELECT id, username, bio, avatar IS NOT NULL AS has_avatar, banniere_x, banniere_y, banniere_zoom FROM users WHERE username = ?").get(req.params.username);
  if (!profil) return res.status(404).send("Utilisateur introuvable");
  const journal = db.prepare(`
    SELECT f.id, f.title, f.poster_path, v.rating, v.watched_on, v.revu
    FROM visionnages v JOIN films f ON f.id = v.film_id
    WHERE v.user_id = ?
    ORDER BY v.watched_on DESC, v.id DESC LIMIT 12
  `).all(profil.id);
  const total = db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE user_id = ?").get(profil.id).n;
  const suit = !!db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?").get(req.session.userId, profil.id);
  const abonnes = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE followed_id = ?").get(profil.id).n;
  const abonnements = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?").get(profil.id).n;
  const favoris = db.prepare(`SELECT f.id, f.title, COALESCE(fa.poster_path, f.poster_path) AS poster_path FROM favorites fa
  JOIN films f ON f.id = fa.film_id WHERE fa.user_id = ? ORDER BY fa.id`).all(profil.id);
  const acteurs = db.prepare("SELECT person_id, nom, photo FROM acteurs_favoris WHERE user_id = ? ORDER BY id").all(profil.id);
  const vus = new Set(db.prepare("SELECT film_id FROM reviews WHERE user_id = ?").all(profil.id).map(r => r.film_id));
  await Promise.all(acteurs.map(async a => {
    const credits = await tmdb("/person/" + a.person_id + "/movie_credits?language=fr-FR").catch(() => null);
    a.films = credits ? credits.cast.filter(f => vus.has(f.id)).length : 0;
  }));

  let banniere = null;
  if (favoris.length > 0) {
    const f = await tmdb("/movie/" + favoris[0].id + "?language=fr-FR").catch(() => null);
    banniere = f && f.backdrop_path;
  }

  let compat = null;
  if (req.session.userId && req.session.userId !== profil.id) {
    const c = db.prepare(`
      SELECT COUNT(*) AS n, AVG(ABS(a.rating - b.rating)) AS ecart
      FROM reviews a JOIN reviews b ON b.film_id = a.film_id
      WHERE a.user_id = ? AND b.user_id = ?
    `).get(req.session.userId, profil.id);
    if (c.n >= 3) compat = { score: Math.round(100 * (1 - c.ecart / 9)), n: c.n };
  }
  res.render("profile", { profil, journal, suit, abonnes, abonnements, favoris, total, banniere, acteurs, compat });
});

app.post("/films/:id/review/delete", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const id = Number(req.params.id);
  db.prepare("DELETE FROM reviews WHERE user_id = ? AND film_id = ?").run(req.session.userId, id);
  db.prepare("DELETE FROM visionnages WHERE user_id = ? AND film_id = ?").run(req.session.userId, id);
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
    const retourOk = /^(\/u\/[^/]+\/(abonnes|abonnements)|\/notifications)$/.test(retour); // liste blanche
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

const PAS_FICTION = [99, 10763, 10764, 10767];
const METIERS = { Acting: ["Acteur", "Actrice"], Directing: ["Réalisateur", "Réalisatrice"], Writing: ["Scénariste", "Scénariste"] };
const vraiRole = f => !(f.genre_ids || []).some(g => PAS_FICTION.includes(g))
  && !/^(self|himself|herself|themselves|lui-même|elle-même)\b/i.test(f.character || "");
const BANNIS = new Set([]);
const acteurOk = p => p.known_for_department === "Acting" && p.profile_path && !p.adult
  && !BANNIS.has(p.id) && (p.known_for || []).some(vraiRole);

// vérification complète sur la filmographie : au moins 3 vrais rôles de fiction
const verdicts = new Map(); // id → true / false (ponytail: cache sans fin, ça reste petit)
async function vraiActeur(p) {
  if (BANNIS.has(p.id)) return false;
  if (verdicts.has(p.id)) return verdicts.get(p.id);
  const c = await tmdb("/person/" + p.id + "/combined_credits?language=en-US").catch(() => null);
  if (!c) return true; // TMDB muet : on ne bloque pas (et on ne garde pas en cache)
  const nom = (p.name || "").toLowerCase();
  const roles = c.cast.filter(f => vraiRole(f)
    && !/archiv/i.test(f.character || "")                       // images d'archives
    && !(nom && (f.character || "").toLowerCase().includes(nom)) // joue son propre rôle
  ).length;
  verdicts.set(p.id, roles >= 3);
  return roles >= 3;
}

let populaires = [];
async function chargerPopulaires() {
  const pages = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    tmdb("/person/popular?language=fr-FR&page=" + (i + 1)).catch(() => null)));
  populaires = pages.flatMap(d => (d ? d.results : []))
    .filter(acteurOk)
    .sort((a, b) => b.popularity - a.popularity);
}
chargerPopulaires();
setInterval(chargerPopulaires, 24 * 60 * 60 * 1000);

function ressemble(q, nom) {
  const a = q.toLowerCase(), b = nom.toLowerCase();
  if (!b.split(/\s+/).some(mot => mot[0] === a[0])) return false;
  let i = 0;
  for (const c of b) if (c === a[i]) i++;
  return i === a.length;
}
async function chercherActeurs(q, combien) {
  const data = await tmdb("/search/person?language=fr-FR&query=" + encodeURIComponent(q)).catch(() => null);
  const exacts = data
      ? data.results.filter(acteurOk)
        .sort((a, b) => b.popularity - a.popularity)
    : [];
  const deja = new Set(exacts.map(p => p.id));
  const proches = q.length >= 3 ? populaires.filter(p => !deja.has(p.id) && ressemble(q, p.name)) : [];
  const candidats = [...exacts, ...proches].slice(0, combien * 2);       // un peu plus, certains seront écartés
  const oks = await Promise.all(candidats.map(vraiActeur));              // vérifiés en parallèle
  return candidats.filter((_, i) => oks[i]).slice(0, combien);
}

app.get("/acteurs", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const q = (req.query.q || "").trim().slice(0, 50);
  const mes = db.prepare("SELECT person_id, nom, photo FROM acteurs_favoris WHERE user_id = ? ORDER BY id").all(req.session.userId);
  const resultats = q ? await chercherActeurs(q, 12) : [];
  const choisis = new Set(mes.map(a => a.person_id));
  res.render("acteurs", { q, mes, resultats, choisis });
});

app.post("/acteurs/:id", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).send("Acteur invalide");
  const retire = db.prepare("DELETE FROM acteurs_favoris WHERE user_id = ? AND person_id = ?").run(req.session.userId, id);
  if (retire.changes === 0) {
    const n = db.prepare("SELECT COUNT(*) AS n FROM acteurs_favoris WHERE user_id = ?").get(req.session.userId).n;
    if (n >= 3) return res.status(400).send("3 acteurs maximum : retires-en un d'abord.");
    // nom et photo demandés à TMDB par le serveur, jamais pris dans le formulaire
    const p = await tmdb("/person/" + id + "?language=fr-FR").catch(() => null);
    if (!p || p.adult || !(await vraiActeur(p))) return res.status(404).send("Acteur introuvable");
    db.prepare("INSERT INTO acteurs_favoris (user_id, person_id, nom, photo) VALUES (?, ?, ?, ?)")
      .run(req.session.userId, id, p.name, p.profile_path);
  }
  const q = (req.body.q || "").slice(0, 50);
  res.redirect("/acteurs" + (q ? "?q=" + encodeURIComponent(q) : ""));
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

let catalogue = [];
(async () => {
  for (let debut = 1; debut <= 50; debut += 10) {
    const lot = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      tmdb("/discover/movie?language=fr-FR&sort_by=vote_count.desc&page=" + (debut + i)).catch(() => null)));
    for (const d of lot) if (d) catalogue.push(...d.results.filter(f => f.poster_path));
  }
  console.log("Catalogue de suggestions :", catalogue.length, "films");
})();

const cibles = new Map();
async function filmDuJour() {
  const jour = aujourdhui();
  if (cibles.has(jour)) return cibles.get(jour);
  let ligne = db.prepare("SELECT film_id FROM jour_films WHERE jour = ?").get(jour);
  if (!ligne) {
    const pris = new Set(db.prepare("SELECT film_id FROM jour_films").all().map(r => r.film_id));
    const libres = catalogue.slice(0, 150).filter(f => !pris.has(f.id));
    if (libres.length === 0) return null;                                 // catalogue pas encore chargé
    const choix = libres[Math.floor(Math.random() * libres.length)];
    db.prepare("INSERT OR IGNORE INTO jour_films (jour, film_id) VALUES (?, ?)").run(jour, choix.id);
    ligne = db.prepare("SELECT film_id FROM jour_films WHERE jour = ?").get(jour);
    if (!ligne) return null;
  }
  const film = await tmdb("/movie/" + ligne.film_id + "?language=fr-FR&append_to_response=credits");
  cibles.clear();
  cibles.set(jour, film);
  return film;
}

app.get("/jour", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const cible = await filmDuJour().catch(() => null);
  if (!cible) return res.render("jour", { pret: false });
  const me = req.session.userId, jour = aujourdhui();
  const anime = req.session.anime || ""; // lu une fois…
  delete req.session.anime;
  const essais = db.prepare("SELECT id, titre, temp, cases FROM jour_essais WHERE user_id = ? AND jour = ? ORDER BY id DESC")
    .all(me, jour)
    .map(e => ({ ...e, cases: JSON.parse(e.cases || "[]") }));
  const trouve = essais.some(e => e.temp === 100);
  const numero = db.prepare("SELECT COUNT(*) AS n FROM jour_films WHERE jour <= ?").get(jour).n;

  const ouverts = new Set(db.prepare("SELECT indice FROM jour_indices WHERE user_id = ? AND jour = ?").all(me, jour).map(r => r.indice));
  const indices = INDICES.map((ind, i) => ({
    n: i, nom: ind.nom, image: !!ind.image,
    reste: Math.max(0, ind.seuil - essais.length),
    valeur: ouverts.has(i) ? ind.valeur(cible) : null,
  }));

  const classement = trouve ? db.prepare(`
    SELECT u.username,
      (SELECT COUNT(*) FROM jour_essais x WHERE x.user_id = e.user_id AND x.jour = e.jour) AS essais,
      (SELECT COUNT(*) FROM jour_indices i WHERE i.user_id = e.user_id AND i.jour = e.jour) AS indices
    FROM jour_essais e JOIN users u ON u.id = e.user_id
    WHERE e.jour = ? AND e.temp = 100
    ORDER BY essais, indices, e.created_at
  `).all(jour) : [];

  res.render("jour", { pret: true, essais, trouve, numero, indices, nbIndices: ouverts.size, classement, anime, cible: trouve ? cible : null });
});

app.post("/jour/indice/:n", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const n = Number(req.params.n), me = req.session.userId, jour = aujourdhui();
  const ind = INDICES[n];
  const etat = db.prepare("SELECT COUNT(*) AS nb, MAX(temp) AS max FROM jour_essais WHERE user_id = ? AND jour = ?").get(me, jour);
  if (ind && etat.nb >= ind.seuil && etat.max !== 100) {
    db.prepare("INSERT OR IGNORE INTO jour_indices (user_id, jour, indice) VALUES (?, ?, ?)").run(me, jour, n);
    req.session.anime = "indice-" + n;
  }
  res.redirect("/jour");
});

app.post("/jour/essai", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const id = Number(req.body.film_id);
  const cible = await filmDuJour().catch(() => null);
  if (!cible || !Number.isInteger(id)) return res.redirect("/jour");
  const me = req.session.userId, jour = aujourdhui();
  if (db.prepare("SELECT 1 FROM jour_essais WHERE user_id = ? AND jour = ? AND temp = 100").get(me, jour)) return res.redirect("/jour");
  const essai = await tmdb("/movie/" + id + "?language=fr-FR&append_to_response=credits").catch(() => null);
  if (!essai) return res.redirect("/jour");
  const { temp, cases } = comparer(cible, essai);
  db.prepare("INSERT OR IGNORE INTO jour_essais (user_id, jour, film_id, titre, temp, cases) VALUES (?, ?, ?, ?, ?, ?)")
    .run(me, jour, essai.id, essai.title + " (" + (annee(essai) || "?") + ")", temp, JSON.stringify(cases));
  req.session.anime = "essai";
  res.redirect("/jour");
});

// ===== Page d'un artiste (acteur, réalisateur) =====
app.get("/personnes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).send("Personne introuvable");
  const p = await tmdb("/person/" + id + "?language=fr-FR&append_to_response=movie_credits").catch(() => null);
  if (!p || p.adult) return res.status(404).send("Personne introuvable");

  // sans doublons, avec affiche, du plus récent au plus ancien (sans date = à la fin)
  const trier = films => [...new Map(films.filter(f => f.poster_path && !f.adult).map(f => [f.id, f])).values()]
    .sort((a, b) => (b.release_date || "").localeCompare(a.release_date || ""));
  const realise = trier(p.movie_credits.crew.filter(f => f.job === "Director"));
  const joue = trier(p.movie_credits.cast);

  // onglet : celui demandé, sinon son métier principal ; jamais un onglet vide
  let role = ["real", "acteur"].includes(req.query.role) ? req.query.role
    : (p.known_for_department === "Directing" ? "real" : "acteur");
  if (role === "real" && realise.length === 0) role = "acteur";
  if (role === "acteur" && joue.length === 0 && realise.length > 0) role = "real";
  const liste = role === "real" ? realise : joue;

  // mes notes : film_id → note (1..10)
  const mesNotes = new Map(req.session.userId
    ? db.prepare("SELECT film_id, rating FROM reviews WHERE user_id = ?").all(req.session.userId).map(r => [r.film_id, r.rating])
    : []);
  const vus = liste.filter(f => mesNotes.has(f.id));
  const moyenne = vus.length ? vus.reduce((s, f) => s + mesNotes.get(f.id), 0) / vus.length / 2 : null;
  const pasVus = req.query.pasvus === "1";
  const films = pasVus ? liste.filter(f => !mesNotes.has(f.id)) : liste;

  res.render("personne", { p, role, realise, joue, films, total: liste.length, nbVus: vus.length, moyenne, mesNotes, pasVus });
});

app.get("/api/suggestions", async (req, res) => {
  const q = (req.query.q || "").trim().slice(0, 50);
  if (!q) return res.json({ films: [], gens: [] });
  const gens = db.prepare("SELECT username FROM users WHERE username LIKE ? ORDER BY length(username) LIMIT 3")
    .all("%" + q + "%");
  if (q.length < 2) return res.json({ films: [], gens });
  const [data, personnes] = await Promise.all([
    q.length < 3 ? { results: [] } : tmdb("/search/movie?language=fr-FR&query=" + encodeURIComponent(q)).catch(() => ({ results: [] })),
    q.length < 4 ? null : tmdb("/search/person?language=fr-FR&query=" + encodeURIComponent(q)).catch(() => null),
  ]);
  const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const qn = norm(q);
  const commence = f => norm(f.title).startsWith(qn) || norm(f.original_title).startsWith(qn);
  const candidats = [...new Map([...catalogue.filter(commence), ...data.results].map(f => [f.id, f])).values()];
  const films = candidats
    .filter(f => f.poster_path && f.vote_count >= 20)
    .sort((a, b) => (commence(b) - commence(a)) || b.vote_count - a.vote_count)
    .slice(0, 3)
    .map(f => ({ id: f.id, title: f.title, year: (f.release_date || "").slice(0, 4), poster: f.poster_path }));
  const proche = p => norm(p.name).split(/\s+/).some(mot => mot.startsWith(qn));
  const possibles = (personnes ? personnes.results : [])
    .filter(p => p.profile_path && !p.adult && METIERS[p.known_for_department] && p.popularity >= 3 && proche(p))
    .slice(0, 3);
  let artiste = null;
  for (const p of possibles) {
    if (p.known_for_department === "Acting" ? await vraiActeur(p) : !BANNIS.has(p.id)) {
      artiste = { id: p.id, nom: p.name, photo: p.profile_path, metier: METIERS[p.known_for_department][p.gender === 1 ? 1 : 0] };
      break;
    }
  }
  res.json({ films, gens, artiste });
});

app.get("/api/acteurs", async (req, res) => {
  const q = (req.query.q || "").trim().slice(0, 50);
  if (!q) return res.json([]);
  const acteurs = await chercherActeurs(q, 6);
  res.json(acteurs.map(p => ({ id: p.id, nom: p.name, photo: p.profile_path })));
});

function estAdmin(req, res, next) {
  if (!res.locals.user || !res.locals.user.is_admin) return res.status(404).send("Page introuvable");
  next();
}

app.get("/admin", estAdmin, (req, res) => {
  const chiffres = db.prepare(`SELECT
    (SELECT COUNT(*) FROM users)   AS membres,
    (SELECT COUNT(*) FROM reviews) AS notes,
    (SELECT COUNT(*) FROM follows) AS abonnements`).get();
  const membres = db.prepare(`SELECT u.id, u.username, u.email, u.is_admin,
      (SELECT COUNT(*) FROM reviews r WHERE r.user_id = u.id) AS notes
    FROM users u ORDER BY u.id DESC`).all();
  const avis = db.prepare(`SELECT r.id, u.username, f.title, r.rating, r.body
    FROM reviews r JOIN users u ON u.id = r.user_id JOIN films f ON f.id = r.film_id
    ORDER BY r.id DESC LIMIT 30`).all();
  res.render("admin", { chiffres, membres, avis });
});

app.post("/admin/membres/:id/supprimer", estAdmin, (req, res) => {
  const id = Number(req.params.id);
  const cible = db.prepare("SELECT id, is_admin FROM users WHERE id = ?").get(id);
  if (!cible || cible.is_admin) return res.status(400).send("Impossible de supprimer ce compte");
  db.transaction(() => {
    db.prepare("DELETE FROM reviews   WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM favorites WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM watchlist WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM follows   WHERE follower_id = ? OR followed_id = ?").run(id, id);
    db.prepare("DELETE FROM sessions  WHERE json_extract(data, '$.userId') = ?").run(id);
    db.prepare("DELETE FROM acteurs_favoris WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM jour_essais WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM visionnages WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users     WHERE id = ?").run(id);
  })();
  res.redirect("/admin");
});

app.post("/admin/avis/:id/supprimer", estAdmin, (req, res) => {
  db.prepare("DELETE FROM reviews WHERE id = ?").run(Number(req.params.id));
  res.redirect("/admin");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "127.0.0.1", () => console.log("Serveur lancé sur http://localhost:" + PORT));