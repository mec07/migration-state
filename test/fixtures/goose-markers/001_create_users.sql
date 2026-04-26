-- +goose Up
CREATE TABLE users (id bigserial PRIMARY KEY, email text NOT NULL);

-- +goose Down
DROP TABLE users;
