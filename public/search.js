const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const results = document.getElementById("results");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const res = await fetch("/api/search?q=" + encodeURIComponent(input.value));
  const films = await res.json();

  results.innerHTML = "";
    for (const film of films) {
    const article = document.createElement("article");

    if (film.poster_path) {
      const poster = document.createElement("img");
      poster.src = "https://image.tmdb.org/t/p/w200" + film.poster_path;
      poster.alt = "Affiche de " + film.title;
      article.append(poster);
    }

    const h3 = document.createElement("h3");
    h3.textContent = film.title;
    const p = document.createElement("p");
    p.textContent = film.release_date.slice(0, 4) + " · " + film.vote_average.toFixed(1) + "/10";
    article.append(h3, p);
    results.append(article);
  }
});