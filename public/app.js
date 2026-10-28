console.log("SosoBox est vivant");

const films = [
    {title: "Babylon", year: 2023, rating: 7, poster: "img/babylon.jpg"},
    {title: "Projet Dernière Chance", year: 2026, rating: 9.5, poster: "img/projet_hail.jpg"},
    { title: "Dune", year: 2021, rating: 6, poster: "img/dune.jpg" },
    {title: "La La land", year: 2016, rating: 8, poster: "img/lalaland.jpg"}
];

function toStars(rating) {
    return rating / 2;
}

function format(film) {
    return `${film.title} (${film.year}) : ${toStars(film.rating)}/5`;
}

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
console.log(bestFilm(films));

const liste = document.querySelector("#liste-films");

function renderFilms(films) {
    liste.textContent = "";
    for (const film of films) {
        const article = document.createElement("article");
        const titre = document.createElement("h2");
        const img = document.createElement("img");
        img.src = film.poster;
        img.alt = film.title;
        article.append(img);
        titre.textContent = format(film);   
        article.append(titre);                                  
        liste.append(article); 
    }
}

const tries = [...films].sort(function (a, b) {
    return b.rating - a.rating;
});

const triesCroissant = [...films].sort(function (a, b) {
    return a.rating - b.rating;
})

const bons = films.filter(function (film) {
    return film.rating >= 8;
});

const btnTous = document.querySelector("#btn-tous")
btnTous.addEventListener("click", function() {
    renderFilms(films);
})

const btnFil = document.querySelector("#btn-bons");
btnFil.addEventListener("click", function() {
    renderFilms(bons);
})

const btnTri = document.querySelector("#btn-tri");
btnTri.addEventListener("click", function () {
    renderFilms(tries);
});

const btnTriCroissant = document.querySelector("#btn-tri-dec");
btnTriCroissant.addEventListener("click", function (){
    renderFilms(triesCroissant)
})

renderFilms(films);