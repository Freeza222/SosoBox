function lireCsv(texte) {
  texte = texte.replace(/^\uFEFF/, "");
  const lignes = [];
  let ligne = [], champ = "", entreGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (entreGuillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') entreGuillemets = false;
      else champ += c;
    } else if (c === '"') entreGuillemets = true;
    else if (c === ",") { ligne.push(champ); champ = ""; }
    else if (c === "\n") { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ""; }
    else if (c !== "\r") champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  const [entete = [], ...reste] = lignes;
  return reste.map(l => Object.fromEntries(entete.map((nom, j) => [nom, l[j] ?? ""])));
}

module.exports = { lireCsv };

if (require.main === module) {
  const assert = require("assert");
  const r = lireCsv('\uFEFFDate,Name,Year,Letterboxd URI,Rating\r\n2024-01-02,"Crazy, Stupid, Love.",2011,https://boxd.it/a,4.5\r\n2024-01-03,"Le ""Mépris""",1963,https://boxd.it/b,5\r\n');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].Name, "Crazy, Stupid, Love.");
  assert.strictEqual(r[0].Rating, "4.5");
  assert.strictEqual(r[1].Name, 'Le "Mépris"');
  assert.strictEqual(r[1].Year, "1963");
  console.log("csv.js : OK");
}