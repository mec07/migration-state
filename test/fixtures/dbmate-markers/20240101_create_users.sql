-- migrate:up
CREATE TABLE users (id bigserial PRIMARY KEY, email text NOT NULL);

-- migrate:down
DROP TABLE users;
