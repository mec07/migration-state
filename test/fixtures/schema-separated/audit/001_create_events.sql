CREATE TABLE events (id bigserial PRIMARY KEY, action text NOT NULL, payload jsonb);
