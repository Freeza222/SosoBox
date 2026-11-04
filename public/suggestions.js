const champ = document.querySelector('input[name="q"]');
const boite = document.getElementById("suggestions");
let derniere = 0;

champ.addEventListener("input", async () => {
  const n = ++derniere;
  const q = champ.value.trim();
  if (!q) { boite.replaceChildren(); return; }
  const films = await (await fetch("/api/suggestions?q=" + encodeURIComponent(q))).json();
  if (n !== derniere) return; // une requête plus récente est partie entre-temps
  boite.replaceChildren(...films.map(f => {
    const a = document.createElement("a");
    a.href = "/films/" + f.id;
    a.className = "sugg";
    const img = document.createElement("img");
    img.alt = "";
    if (f.poster) img.src = "https://image.tmdb.org/t/p/w92" + f.poster;
    else img.style.visibility = "hidden";
    a.append(img, f.title + (f.year ? " (" + f.year + ")" : ""));
    return a;
  }));
});

document.addEventListener("click", e => {
  if (e.target !== champ) boite.replaceChildren();
});