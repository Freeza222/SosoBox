console.log(process.env.TMDB_TOKEN ? "Clé TMDB trouvée" : "Clé TMDB manquante");
const express = require("express");
const db = require("./db");
const { tmdb } = require("./tmdb");
const app = express();
app.set("view engine", "ejs");
app.use(express.static("public"));


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

app.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});