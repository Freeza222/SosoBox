async function chargerPopulaires() {
  const r = await fetch("/api/populaires");
  const data = await r.json();
  const liste = document.getElementById("populaires");
  for (const f of data.results) {
    const li = document.createElement("li");
    li.textContent = f.title;
    liste.append(li);
  }
}
chargerPopulaires();