const largeur = Math.max(screen.width, innerWidth);
const couleurs = ["#ffffff", "#ffffff", "#e0d0ff", "#C9C2E3"];
document.querySelectorAll(".couche").forEach(couche => {
  const n = Number(couche.dataset.nombre);
  const points = [];
  for (let i = 0; i < n; i++) {
    const x = Math.floor(Math.random() * largeur);
    const y = Math.floor(Math.random() * 2000);
    points.push(x + "px " + y + "px " + couleurs[i % couleurs.length]);
  }
  couche.style.setProperty("--etoiles", points.join(", "));
});