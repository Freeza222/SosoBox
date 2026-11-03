async function tmdb(chemin) {
  const r = await fetch("https://api.themoviedb.org/3" + chemin, {
    headers: { Authorization: `Bearer ${process.env.TMDB_TOKEN}` },
  });
  if (!r.ok) throw new Error("TMDB " + r.status);
  return r.json();
}

module.exports = { tmdb };