CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar BLOB,
  avatar_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS films (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  year INTEGER,
  poster_path TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  film_id INTEGER NOT NULL REFERENCES films(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
  body TEXT NOT NULL DEFAULT '',
  watched_on TEXT,
  UNIQUE (user_id, film_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id),
  followed_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  film_id INTEGER NOT NULL REFERENCES films(id),
  UNIQUE (user_id, film_id)
);

CREATE TABLE IF NOT EXISTS watchlist (
  user_id INTEGER NOT NULL REFERENCES users(id),
  film_id INTEGER NOT NULL REFERENCES films(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, film_id)
);

CREATE TABLE IF NOT EXISTS jour_films (
  jour TEXT PRIMARY KEY,
  film_id INTEGER NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS jour_essais (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  jour TEXT NOT NULL,
  film_id INTEGER NOT NULL,
  titre TEXT NOT NULL,
  temp INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, jour, film_id)
);