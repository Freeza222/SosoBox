console.log("SosoBox est vivant");

let films = [];

function toStars(rating) {
    return rating / 2;
}

function format(film) {
    return `${film.title} (${film.year}) : ${toStars(film.rating)}/5`;
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


const btnTous = document.querySelector("#btn-tous")
btnTous.addEventListener("click", function() {
    renderFilms(films);
})

const btnFil = document.querySelector("#btn-bons");
btnFil.addEventListener("click", function() {
    const bons = films.filter(function (film) {
    return film.rating >= 8;
    });
    renderFilms(bons);
});

const btnTri = document.querySelector("#btn-tri");
btnTri.addEventListener("click", function () {
  const tries = [...films].sort(function (a, b) {
    return b.rating - a.rating;
  });
  renderFilms(tries);
});

const btnTriCroissant = document.querySelector("#btn-tri-dec");
btnTriCroissant.addEventListener("click", function (){
    const triesCroissant = [...films].sort(function (a, b) {
    return a.rating - b.rating;
    });
    renderFilms(triesCroissant)
});

async function loadFilms() {
  const res = await fetch("/api/films");
  films = await res.json();
  renderFilms(films);
}

loadFilms();