# SosoBox

Mon Letterboxd perso : je note les films que je vois, j'écris ce que j'en ai pensé, et je suis ce que regardent mes amis.

**https://sosobox.duckdns.org**

C'est un projet perso, sans but commercial, que j'ai construit pour apprendre le web en partant du C.

## Ce qu'on peut y faire

- Noter un film de ½ à 5 étoiles, avec une critique et la date où on l'a vu
- Suivre ses amis et voir leurs avis sur l'accueil
- Choisir ses 4 films préférés (et les réordonner en les glissant)
- Garder une liste de films à voir
- Parcourir les films populaires, les mieux notés et ceux au cinéma
- Voir ses stats : moyenne, notes les plus données, films vus par année

Le tout marche aussi bien sur téléphone que sur ordinateur.

## Sous le capot

Node.js, Express, EJS, SQLite et du CSS fait main. Les infos des films viennent de l'API TMDB.

## Le lancer chez soi

```bash
git clone git@github.com:Freeza222/SosoBox.git
cd SosoBox
npm install
```

Crée un fichier `.env` avec ta clé TMDB (gratuite sur [themoviedb.org](https://www.themoviedb.org/settings/api)) et un secret de session :

```
TMDB_TOKEN=ta_cle_tmdb
SESSION_SECRET=une_longue_chaine_au_hasard
```

Puis `npm run dev` et direction <http://localhost:3000>.

## En ligne

Le site tourne sur un petit serveur Ubuntu (Azure for Students), derrière Caddy pour le HTTPS. La base est sauvegardée chaque nuit.

Pour mettre à jour après un `git push` :

```bash
ssh ubuntu@<IP_DU_SERVEUR> 'cd ~/SosoBox && git pull && npm ci --omit=dev && sudo systemctl restart sosobox'
```

## Merci

À [TMDB](https://www.themoviedb.org/) pour les données des films. Ce produit utilise l'API TMDB, mais il n'est ni approuvé ni certifié par TMDB.
