CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  age INTEGER NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT,
  price REAL,
  obsolete TEXT
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL
);
