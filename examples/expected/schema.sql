--
-- PostgreSQL database dump
--

-- Dumped from database version 16.11 (Homebrew)
-- Dumped by pg_dump version 16.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: api; Type: SCHEMA; Schema: -; Owner: powerx
--

CREATE SCHEMA api;


ALTER SCHEMA api OWNER TO powerx;

--
-- Name: audit; Type: SCHEMA; Schema: -; Owner: powerx
--

CREATE SCHEMA audit;


ALTER SCHEMA audit OWNER TO powerx;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: address; Type: TYPE; Schema: public; Owner: powerx
--

CREATE TYPE public.address AS (
	street text,
	city text,
	postcode character varying(10),
	country character varying(2)
);


ALTER TYPE public.address OWNER TO powerx;

--
-- Name: email_address; Type: DOMAIN; Schema: public; Owner: powerx
--

CREATE DOMAIN public.email_address AS character varying(255)
	CONSTRAINT email_address_check CHECK (((VALUE)::text ~ '^[^@]+@[^@]+\.[^@]+$'::text));


ALTER DOMAIN public.email_address OWNER TO powerx;

--
-- Name: order_status; Type: TYPE; Schema: public; Owner: powerx
--

CREATE TYPE public.order_status AS ENUM (
    'pending',
    'confirmed',
    'shipped',
    'delivered',
    'cancelled',
    'refunded'
);


ALTER TYPE public.order_status OWNER TO powerx;

--
-- Name: priority_level; Type: TYPE; Schema: public; Owner: powerx
--

CREATE TYPE public.priority_level AS ENUM (
    'low',
    'medium',
    'high',
    'urgent'
);


ALTER TYPE public.priority_level OWNER TO powerx;

--
-- Name: user_status; Type: TYPE; Schema: public; Owner: powerx
--

CREATE TYPE public.user_status AS ENUM (
    'active',
    'suspended',
    'deleted'
);


ALTER TYPE public.user_status OWNER TO powerx;

--
-- Name: log_change(); Type: FUNCTION; Schema: audit; Owner: powerx
--

CREATE FUNCTION audit.log_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO audit.events (table_name, action, row_id, payload)
  VALUES (TG_TABLE_NAME, TG_OP, NEW.id, to_jsonb(NEW));
  RETURN NEW;
END;
$$;


ALTER FUNCTION audit.log_change() OWNER TO powerx;

--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: powerx
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at() OWNER TO powerx;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: orders; Type: TABLE; Schema: public; Owner: powerx
--

CREATE TABLE public.orders (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    org_id bigint,
    total_cents integer DEFAULT 0 NOT NULL,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    priority public.priority_level DEFAULT 'medium'::public.priority_level NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    shipped_at timestamp with time zone,
    total_display text GENERATED ALWAYS AS ((total_cents)::text) STORED,
    CONSTRAINT orders_total_cents_check CHECK ((total_cents >= 0))
);


ALTER TABLE public.orders OWNER TO powerx;

--
-- Name: users; Type: TABLE; Schema: public; Owner: powerx
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    email character varying(255) NOT NULL,
    full_name character varying(500) DEFAULT 'Unnamed'::character varying NOT NULL,
    status public.user_status DEFAULT 'active'::public.user_status NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    verified boolean DEFAULT false,
    last_login timestamp with time zone,
    login_count integer DEFAULT 0
);


ALTER TABLE public.users OWNER TO powerx;

--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: powerx
--

COMMENT ON TABLE public.users IS 'Core user accounts';


--
-- Name: COLUMN users.email; Type: COMMENT; Schema: public; Owner: powerx
--

COMMENT ON COLUMN public.users.email IS 'Primary login identifier, must be unique';


--
-- Name: order_summary; Type: VIEW; Schema: api; Owner: powerx
--

CREATE VIEW api.order_summary AS
 SELECT o.id,
    u.email AS user_email,
    u.full_name AS user_name,
    o.total_cents,
    o.status,
    o.priority,
    o.notes,
    o.created_at
   FROM (public.orders o
     JOIN public.users u ON ((u.id = o.user_id)))
  WHERE (o.status <> 'cancelled'::public.order_status);


ALTER VIEW api.order_summary OWNER TO powerx;

--
-- Name: tokens; Type: TABLE; Schema: api; Owner: powerx
--

CREATE TABLE api.tokens (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE api.tokens OWNER TO powerx;

--
-- Name: TABLE tokens; Type: COMMENT; Schema: api; Owner: powerx
--

COMMENT ON TABLE api.tokens IS 'API authentication tokens';


--
-- Name: tokens_id_seq; Type: SEQUENCE; Schema: api; Owner: powerx
--

CREATE SEQUENCE api.tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE api.tokens_id_seq OWNER TO powerx;

--
-- Name: tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: api; Owner: powerx
--

ALTER SEQUENCE api.tokens_id_seq OWNED BY api.tokens.id;


--
-- Name: events; Type: TABLE; Schema: audit; Owner: powerx
--

CREATE TABLE audit.events (
    id bigint NOT NULL,
    table_name text NOT NULL,
    action text NOT NULL,
    row_id bigint,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE audit.events OWNER TO powerx;

--
-- Name: TABLE events; Type: COMMENT; Schema: audit; Owner: powerx
--

COMMENT ON TABLE audit.events IS 'Audit trail for all data changes';


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: audit; Owner: powerx
--

CREATE SEQUENCE audit.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE audit.events_id_seq OWNER TO powerx;

--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: audit; Owner: powerx
--

ALTER SEQUENCE audit.events_id_seq OWNED BY audit.events.id;


--
-- Name: order_events; Type: TABLE; Schema: audit; Owner: powerx
--

CREATE TABLE audit.order_events (
    event_type text NOT NULL,
    order_id bigint NOT NULL
)
INHERITS (audit.events);


ALTER TABLE audit.order_events OWNER TO powerx;

--
-- Name: active_users; Type: VIEW; Schema: public; Owner: powerx
--

CREATE VIEW public.active_users AS
 SELECT id,
    email,
    full_name,
    verified,
    created_at
   FROM public.users
  WHERE (status = 'active'::public.user_status);


ALTER VIEW public.active_users OWNER TO powerx;

--
-- Name: invoice_number_seq; Type: SEQUENCE; Schema: public; Owner: powerx
--

CREATE SEQUENCE public.invoice_number_seq
    START WITH 10000
    INCREMENT BY 1
    MINVALUE 10000
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoice_number_seq OWNER TO powerx;

--
-- Name: measurements; Type: TABLE; Schema: public; Owner: powerx
--

CREATE TABLE public.measurements (
    id bigint NOT NULL,
    sensor_id integer NOT NULL,
    measured_at timestamp with time zone NOT NULL,
    value double precision
)
PARTITION BY RANGE (measured_at);


ALTER TABLE public.measurements OWNER TO powerx;

--
-- Name: measurements_id_seq; Type: SEQUENCE; Schema: public; Owner: powerx
--

CREATE SEQUENCE public.measurements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.measurements_id_seq OWNER TO powerx;

--
-- Name: measurements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: powerx
--

ALTER SEQUENCE public.measurements_id_seq OWNED BY public.measurements.id;


--
-- Name: measurements_2025; Type: TABLE; Schema: public; Owner: powerx
--

CREATE TABLE public.measurements_2025 (
    id bigint DEFAULT nextval('public.measurements_id_seq'::regclass) NOT NULL,
    sensor_id integer NOT NULL,
    measured_at timestamp with time zone NOT NULL,
    value double precision
);


ALTER TABLE public.measurements_2025 OWNER TO powerx;

--
-- Name: measurements_2026; Type: TABLE; Schema: public; Owner: powerx
--

CREATE TABLE public.measurements_2026 (
    id bigint DEFAULT nextval('public.measurements_id_seq'::regclass) NOT NULL,
    sensor_id integer NOT NULL,
    measured_at timestamp with time zone NOT NULL,
    value double precision
);


ALTER TABLE public.measurements_2026 OWNER TO powerx;

--
-- Name: orders_id_seq; Type: SEQUENCE; Schema: public; Owner: powerx
--

CREATE SEQUENCE public.orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.orders_id_seq OWNER TO powerx;

--
-- Name: orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: powerx
--

ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;


--
-- Name: organisations; Type: TABLE; Schema: public; Owner: powerx
--

CREATE TABLE public.organisations (
    id bigint NOT NULL,
    name text NOT NULL,
    parent_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.organisations OWNER TO powerx;

--
-- Name: organisations_id_seq; Type: SEQUENCE; Schema: public; Owner: powerx
--

CREATE SEQUENCE public.organisations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.organisations_id_seq OWNER TO powerx;

--
-- Name: organisations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: powerx
--

ALTER SEQUENCE public.organisations_id_seq OWNED BY public.organisations.id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: powerx
--

CREATE TABLE public.user_roles (
    user_id bigint NOT NULL,
    role_id bigint NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_roles OWNER TO powerx;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: powerx
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO powerx;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: powerx
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: measurements_2025; Type: TABLE ATTACH; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.measurements ATTACH PARTITION public.measurements_2025 FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2026-01-01 00:00:00+00');


--
-- Name: measurements_2026; Type: TABLE ATTACH; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.measurements ATTACH PARTITION public.measurements_2026 FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');


--
-- Name: tokens id; Type: DEFAULT; Schema: api; Owner: powerx
--

ALTER TABLE ONLY api.tokens ALTER COLUMN id SET DEFAULT nextval('api.tokens_id_seq'::regclass);


--
-- Name: events id; Type: DEFAULT; Schema: audit; Owner: powerx
--

ALTER TABLE ONLY audit.events ALTER COLUMN id SET DEFAULT nextval('audit.events_id_seq'::regclass);


--
-- Name: order_events id; Type: DEFAULT; Schema: audit; Owner: powerx
--

ALTER TABLE ONLY audit.order_events ALTER COLUMN id SET DEFAULT nextval('audit.events_id_seq'::regclass);


--
-- Name: order_events created_at; Type: DEFAULT; Schema: audit; Owner: powerx
--

ALTER TABLE ONLY audit.order_events ALTER COLUMN created_at SET DEFAULT now();


--
-- Name: measurements id; Type: DEFAULT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.measurements ALTER COLUMN id SET DEFAULT nextval('public.measurements_id_seq'::regclass);


--
-- Name: orders id; Type: DEFAULT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);


--
-- Name: organisations id; Type: DEFAULT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.organisations ALTER COLUMN id SET DEFAULT nextval('public.organisations_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: tokens tokens_pkey; Type: CONSTRAINT; Schema: api; Owner: powerx
--

ALTER TABLE ONLY api.tokens
    ADD CONSTRAINT tokens_pkey PRIMARY KEY (id);


--
-- Name: tokens tokens_token_key; Type: CONSTRAINT; Schema: api; Owner: powerx
--

ALTER TABLE ONLY api.tokens
    ADD CONSTRAINT tokens_token_key UNIQUE (token);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: audit; Owner: powerx
--

ALTER TABLE ONLY audit.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: measurements measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.measurements
    ADD CONSTRAINT measurements_pkey PRIMARY KEY (id, measured_at);


--
-- Name: measurements_2025 measurements_2025_pkey; Type: CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.measurements_2025
    ADD CONSTRAINT measurements_2025_pkey PRIMARY KEY (id, measured_at);


--
-- Name: measurements_2026 measurements_2026_pkey; Type: CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.measurements_2026
    ADD CONSTRAINT measurements_2026_pkey PRIMARY KEY (id, measured_at);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: organisations organisations_pkey; Type: CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT organisations_pkey PRIMARY KEY (id);


--
-- Name: orders uq_orders_user_status; Type: CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT uq_orders_user_status UNIQUE (user_id, status);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_tokens_expires; Type: INDEX; Schema: api; Owner: powerx
--

CREATE INDEX idx_tokens_expires ON api.tokens USING btree (expires_at);


--
-- Name: idx_tokens_user; Type: INDEX; Schema: api; Owner: powerx
--

CREATE INDEX idx_tokens_user ON api.tokens USING btree (user_id);


--
-- Name: idx_audit_events_table; Type: INDEX; Schema: audit; Owner: powerx
--

CREATE INDEX idx_audit_events_table ON audit.events USING btree (table_name, created_at DESC);


--
-- Name: idx_active_orders; Type: INDEX; Schema: public; Owner: powerx
--

CREATE INDEX idx_active_orders ON public.orders USING btree (user_id) WHERE (status <> 'cancelled'::public.order_status);


--
-- Name: idx_orders_recent; Type: INDEX; Schema: public; Owner: powerx
--

CREATE INDEX idx_orders_recent ON public.orders USING btree (user_id, created_at DESC);


--
-- Name: idx_users_email_lower; Type: INDEX; Schema: public; Owner: powerx
--

CREATE UNIQUE INDEX idx_users_email_lower ON public.users USING btree (lower((email)::text));


--
-- Name: idx_users_metadata; Type: INDEX; Schema: public; Owner: powerx
--

CREATE INDEX idx_users_metadata ON public.users USING gin (metadata);


--
-- Name: measurements_2025_pkey; Type: INDEX ATTACH; Schema: public; Owner: powerx
--

ALTER INDEX public.measurements_pkey ATTACH PARTITION public.measurements_2025_pkey;


--
-- Name: measurements_2026_pkey; Type: INDEX ATTACH; Schema: public; Owner: powerx
--

ALTER INDEX public.measurements_pkey ATTACH PARTITION public.measurements_2026_pkey;


--
-- Name: users audit_users; Type: TRIGGER; Schema: public; Owner: powerx
--

CREATE TRIGGER audit_users AFTER INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION audit.log_change();


--
-- Name: orders set_orders_updated_at; Type: TRIGGER; Schema: public; Owner: powerx
--

CREATE TRIGGER set_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: users set_updated_at; Type: TRIGGER; Schema: public; Owner: powerx
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: tokens tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: powerx
--

ALTER TABLE ONLY api.tokens
    ADD CONSTRAINT tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: orders fk_orders_org; Type: FK CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT fk_orders_org FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON UPDATE RESTRICT ON DELETE SET NULL;


--
-- Name: orders orders_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE SET NULL;


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: organisations organisations_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT organisations_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.organisations(id) ON DELETE SET NULL;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: powerx
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: powerx
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: orders user_sees_own_orders; Type: POLICY; Schema: public; Owner: powerx
--

CREATE POLICY user_sees_own_orders ON public.orders FOR SELECT USING ((user_id = (current_setting('app.current_user_id'::text, true))::bigint));


--
-- PostgreSQL database dump complete
--

