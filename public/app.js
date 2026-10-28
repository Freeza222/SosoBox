console.log("SosoBox est vivant");

const films = [
    {title: "Babylon", year: 2023, rating: 10, poster: "img/babylon.jpg"},
    {title: "Projet Dernière Chance", year: 2026, rating: 10, poster: "img/projet_hail.jpg"},
];

console.log(films.length);
console.log(films[0].title);
films.push({ title: "Dune", year: 2021, rating: 10, poster: "img/dune.jpg" });

let total = films[0].rating + films[1].rating + films[2].rating

for (const film of films) {
    console.log(film.title);
}

console.log(total/films.length);