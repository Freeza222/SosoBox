console.log(process.env.TMDB_TOKEN ? "Clé TMDB trouvée" : "Clé TMDB manquante");
const express = require("express");
const app = express();
const films = [
    {title: "Babylon", year: 2023, rating: 7, poster: "img/babylon.jpg"},
    {title: "Projet Dernière Chance", year: 2026, rating: 9.5, poster: "img/projet_hail.jpg"},
    { title: "Dune", year: 2021, rating: 8, poster: "img/dune.jpg" },
    {title: "La La land", year: 2016, rating: 8, poster: "img/lalaland.jpg"} 
];
app.use(express.static("public"));

app.get("/api/films", (req, res) => {
  res.json(films);
});

app.get("/api/search", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({error : "Paramètre manquant"})
  const url = "https://api.themoviedb.org/3/search/movie?language=fr-FR&query=" + encodeURIComponent(q);
  const tmdb = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.TMDB_TOKEN}` },
  });
  const data = await tmdb.json();
  if (!tmdb.ok) {
    return res.status(502).json({ error: data.status_message });
  }
  res.json(data.results);
});

app.get("/api/films/:id", async (req, res) => {
  const id = req.params.id;
  const tmdb = await fetch(
    "https://api.themoviedb.org/3/movie/" + encodeURIComponent(id) + "?language=fr-FR",
    { headers: { Authorization: "Bearer " + process.env.TMDB_TOKEN } }
  );
  const data = await tmdb.json();

  if (!tmdb.ok) {
    return res.status(tmdb.status).json({ error: data.status_message });
  }
  res.json(data);
});

app.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});