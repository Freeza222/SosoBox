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

app.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});