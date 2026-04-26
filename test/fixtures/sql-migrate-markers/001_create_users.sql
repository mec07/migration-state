-- +migrate Up
CREATE TABLE users (id bigserial PRIMARY KEY, email text NOT NULL);

-- +migrate Down
DROP TABLE users;
