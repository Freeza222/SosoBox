const champ = document.querySelector('input[name="q"]');
const boite = document.getElementById("suggestions");
let derniere = 0;

// une ligne de suggestion : image + texte (jamais de HTML, que du texte)
function ligne(href, image, texte, rond) {
  const a = document.createElement("a");
  a.href = href;
  a.className = "sugg";
  const img = document.createElement("img");
  img.alt = "";
  if (image) img.src = image;
  else img.style.visibility = "hidden";
  if (rond) img.className = "rond";
  a.append(img, texte);
  return a;
}

champ.addEventListener("input", async () => {
  const n = ++derniere;
  const q = champ.value.trim();
  if (!q) { boite.replaceChildren(); return; }
  const { films, gens, artiste } = await (await fetch("/api/suggestions?q=" + encodeURIComponent(q))).json();
  if (n !== derniere) return; // une requête plus récente est partie entre-temps
  const blocArtiste = [];
  if (artiste) {
    const titre = document.createElement("div");
    titre.className = "sugg-titre";
    titre.textContent = "Artiste";
    const l = ligne("/personnes/" + artiste.id, "https://image.tmdb.org/t/p/w92" + artiste.photo, artiste.nom, true);
    const metier = document.createElement("small");
    metier.textContent = " · " + artiste.metier;
    l.append(metier);
    const tous = document.createElement("a");
    tous.className = "sugg-tous";
    tous.href = "/search?q=" + encodeURIComponent(q) + "&onglet=artistes";
    tous.textContent = "Tous les artistes pour « " + q + " » →";
    blocArtiste.push(titre, l, tous);
  }

  boite.replaceChildren(
    ...gens.map(u => {
      const lien = "/u/" + encodeURIComponent(u.username);
      return ligne(lien, lien + "/avatar", u.username, true);
    }),
    ...films.map(f => ligne(
      "/films/" + f.id,
      f.poster && "https://image.tmdb.org/t/p/w92" + f.poster,
      f.title + (f.year ? " (" + f.year + ")" : ""),
      false
    )),
    ...blocArtiste
  );
});

document.addEventListener("click", e => {
  if (e.target !== champ) boite.replaceChildren();
});