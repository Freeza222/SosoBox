// Faire défiler les rangées en les tirant à la souris (au doigt, le navigateur le fait déjà)
for (const r of document.querySelectorAll(".rangee")) {
  let x0 = 0, scroll0 = 0, tire = false, bouge = false;

  r.addEventListener("pointerdown", e => {
    if (e.pointerType !== "mouse" || e.button !== 0) return; // souris, bouton gauche seulement
    tire = true; bouge = false;
    x0 = e.clientX; scroll0 = r.scrollLeft;
  });

  r.addEventListener("pointermove", e => {
    if (!tire) return;
    const dx = e.clientX - x0;
    if (!bouge && Math.abs(dx) < 6) return; // moins de 6 px : c'est encore un clic
    if (!bouge) { bouge = true; r.setPointerCapture(e.pointerId); r.classList.add("tire"); }
    r.scrollLeft = scroll0 - dx; // la rangée suit la souris
  });

  const fin = () => { tire = false; r.classList.remove("tire"); };
  r.addEventListener("pointerup", fin);
  r.addEventListener("pointercancel", fin);

  // après un glissement, le relâchement ne doit pas ouvrir le film
  r.addEventListener("click", e => {
    if (bouge) { e.preventDefault(); e.stopPropagation(); bouge = false; }
  }, true);

  // empêche le navigateur de "prendre" l'affiche comme une image à déposer ailleurs
  r.addEventListener("dragstart", e => e.preventDefault());
}