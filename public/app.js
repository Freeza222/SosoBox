console.log("SosoBox est vivant");

const films = [
    {title: "Babylon", year: 2023, rating: 7, poster: "img/babylon.jpg"},
    {title: "Projet Dernière Chance", year: 2026, rating: 9.5, poster: "img/projet_hail.jpg"},
    { title: "Dune", year: 2021, rating: 6, poster: "img/dune.jpg" },
];

function toStars(rating) {
    return rating / 2;
}

function format(film) {
    return `${films.title} (${films.year}) : ${toStars(films.rating)}/5`;
}

let best = films[0]

for (const film of films) {
    console.log(format(film));
}

function bestFilm(films) {
    let best = films[0];
    for (const film of films) {
        if (film.rating > best.rating) {
            best = film;
        }
    }
    return best;
}

function average(films) {
    let total = 0

    for (const film of films) {
        total = total + toStars(film.rating)
    }
    return total/films.length;
}

console.log(average(films));
console.log(best.title);