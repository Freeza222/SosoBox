// Film du jour : comparaison d'un essai avec le film mystère
const annee = f => Number((f.release_date || "").slice(0, 4)) || 0;

// → { temp: 0..100, cases: les 4 cases de la grille (Année, Genres, Réal., Casting) }
function comparer(cible, essai) {
  const trouve = cible.id === essai.id;
  const reals = f => f.credits.crew.filter(p => p.job === "Director");
  const acteurs = f => f.credits.cast.slice(0, 10); // les 10 premiers rôles
  const idsReal = new Set(reals(cible).map(p => p.id));
  const idsActeurs = new Set(acteurs(cible).map(p => p.id));
  const idsGenres = new Set(cible.genres.map(g => g.id));

  const memeReal = reals(essai).some(p => idsReal.has(p.id));
  const acteursCommuns = acteurs(essai).filter(p => idsActeurs.has(p.id));
  const genresCommuns = essai.genres.filter(g => idsGenres.has(g.id));
  const ecart = annee(cible) - annee(essai); // > 0 : le film mystère est plus récent
  const saga = cible.belongs_to_collection;
  const memeSaga = !!saga && saga.id === essai.belongs_to_collection?.id;

  const temp = trouve ? 100 : Math.min(99,
    (memeReal ? 35 : 0)
    + Math.min(24, 8 * acteursCommuns.length)
    + Math.min(18, 6 * genresCommuns.length)
    + Math.max(0, 15 - Math.abs(ecart))
    + (memeSaga ? 8 : 0));

  const etat = (oui, mi) => (trouve || oui ? "oui" : mi ? "mi" : "non");
  const nom = p => p ? p.name.split(" ").pop() : "—"; // juste le nom de famille, ça tient dans la case
  const memesGenres = genresCommuns.length === essai.genres.length && essai.genres.length === cible.genres.length;
  const cases = [
    { lab: "Année", val: annee(essai) + (ecart > 0 ? " ↑" : ecart < 0 ? " ↓" : ""), etat: etat(ecart === 0, Math.abs(ecart) <= 5) },
    { lab: "Genres", val: essai.genres.slice(0, 2).map(g => g.name).join(", ") || "—", etat: etat(memesGenres, genresCommuns.length > 0) },
    { lab: "Réal.", val: nom(reals(essai)[0]), etat: etat(memeReal, false) },
    { lab: "Casting", val: acteursCommuns.length ? nom(acteursCommuns[0]) + (acteursCommuns.length > 1 ? " +" + (acteursCommuns.length - 1) : "") : "—",
      etat: etat(acteursCommuns.length >= 3, acteursCommuns.length > 0) },
  ];
  return { temp, cases };
}

module.exports = { annee, comparer };

// Auto-test : node src/jour.js
if (require.main === module) {
  const assert = require("assert");
  const film = (id, an, genres, real, cast, saga) => ({
    id, release_date: an + "-01-01", genres: genres.map(g => ({ id: g, name: "G" + g })),
    credits: { crew: [{ id: real, job: "Director", name: "Réal " + real }], cast: cast.map(c => ({ id: c, name: "Acteur " + c })) },
    belongs_to_collection: saga ? { id: saga } : null,
  });
  const interstellar = film(1, 2014, [878, 18], 10, [100, 101, 102]);
  const inception = film(2, 2010, [878, 28], 10, [101, 200]);
  const titanic = film(3, 1997, [18, 10749], 20, [300]);

  assert.strictEqual(comparer(interstellar, interstellar).temp, 100);
  assert.ok(comparer(interstellar, interstellar).cases.every(c => c.etat === "oui"));

  const i = comparer(interstellar, inception); // 35 réal + 8 acteur + 6 genre + 11 année = 60
  assert.strictEqual(i.temp, 60);
  assert.deepStrictEqual(i.cases.map(c => c.etat), ["mi", "mi", "oui", "mi"]);
  assert.strictEqual(i.cases[0].val, "2010 ↑");

  const t = comparer(interstellar, titanic); // 6 genre + 0 année
  assert.strictEqual(t.temp, 6);
  assert.deepStrictEqual(t.cases.map(c => c.etat), ["non", "mi", "non", "non"]);

  const suite = comparer(film(4, 2001, [12], 30, [1], 99), film(5, 2002, [12], 31, [2], 99)); // même saga
  assert.strictEqual(suite.temp, 6 + 14 + 8);
  console.log("jour.js : OK");
}