-- +goose Up
-- Migration 02: Enum types
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled');
CREATE TYPE priority_level AS ENUM ('low', 'medium', 'high', 'critical');
-- +goose Down
-- (down migration omitted for testing)
