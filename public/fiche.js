const fiche = document.getElementById("fiche");

async function loadFilm() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

    if (!id) {
    fiche.textContent = "Aucun film demandé.";
    return;
  }

  const res = await fetch("/api/films/" + encodeURIComponent(id));
  const film = await res.json();

    if (res.status === 404) {
    fiche.textContent = "Ce film n'existe pas.";
    return;
  }
  if (!res.ok) {
    fiche.textContent = "Erreur : " + film.error;
    return;
  }

  fiche.innerHTML = "";
  document.title = "SosoBox - " + film.title;

  if (film.poster_path) {
    const poster = document.createElement("img");
    poster.src = "https://image.tmdb.org/t/p/w300" + film.poster_path;
    poster.alt = "Affiche de " + film.title;
    fiche.append(poster);
  }

  const h1 = document.createElement("h1");
  h1.textContent = film.title + " (" + film.release_date.slice(0, 4) + ")";

  const infos = document.createElement("p");
  const genres = film.genres.map((g) => g.name).join(", ");
  infos.textContent = film.runtime + " min · " + genres;

  const resume = document.createElement("p");
  resume.textContent = film.overview;
    const realisateur = film.credits.crew.find((p) => p.job === "Director");
  const acteurs = film.credits.cast.slice(0, 5).map((a) => a.name).join(", ");

  const equipe = document.createElement("p");
  equipe.textContent = "De " + (realisateur ? realisateur.name : "inconnu") + ", avec " + acteurs;
  fiche.append(h1, infos, resume, equipe);
}

loadFilm();