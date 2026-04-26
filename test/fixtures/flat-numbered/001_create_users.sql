CREATE TABLE users (
  id bigserial PRIMARY KEY,
  email varchar(255) NOT NULL UNIQUE,
  name text DEFAULT ''
);
