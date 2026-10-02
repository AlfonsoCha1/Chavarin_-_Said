-- 001_init.sql — Esquema inicial de la plataforma de lealtad
-- Reglas clave que el esquema hace cumplir:
--   * El saldo nunca es negativo (CHECK).
--   * Una referencia de compra (ticket) solo puede registrarse una vez por sucursal.
--   * Cada operación tiene una clave de idempotencia única.
--   * El historial de movimientos y la bitácora de auditoría no se pueden editar ni borrar.

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id serial PRIMARY KEY,
  parent_id int REFERENCES categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL,
  phone text,
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT false,
  is_platform_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  logo_url text,
  card_color text NOT NULL DEFAULT '#1C2433' CHECK (card_color ~ '^#[0-9A-Fa-f]{6}$'),
  contact_email text,
  contact_phone text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended','cancelled')),
  review_note text,
  is_demo boolean NOT NULL DEFAULT false,
  pilot boolean NOT NULL DEFAULT false,
  pilot_start date,
  pilot_end date,
  pilot_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]{3,60}$'),
  name text NOT NULL,
  street text NOT NULL,
  neighborhood text,
  city text NOT NULL,
  state text,
  postal_code text,
  category_id int NOT NULL REFERENCES categories(id),
  hours text,
  phone text,
  lat numeric(9,6),
  lng numeric(9,6),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX branches_company ON branches(company_id);

CREATE TABLE programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('points','stamps')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','closed')),
  card_transferable boolean NOT NULL DEFAULT false,
  redeem_verification text NOT NULL DEFAULT 'none' CHECK (redeem_verification IN ('none','otp')),
  max_purchases_per_card_per_day int NOT NULL DEFAULT 3 CHECK (max_purchases_per_card_per_day BETWEEN 1 AND 50),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Versiones de reglas: nunca se recalcula el pasado; cada compra guarda la versión aplicada.
CREATE TABLE program_versions (
  id serial PRIMARY KEY,
  program_id uuid NOT NULL REFERENCES programs(id),
  version int NOT NULL,
  points_per_purchase int NOT NULL CHECK (points_per_purchase BETWEEN 1 AND 10000),
  min_purchase_cents int NOT NULL DEFAULT 0 CHECK (min_purchase_cents >= 0),
  expiration_days int CHECK (expiration_days IS NULL OR expiration_days >= 30),
  eligible_description text NOT NULL,
  terms text NOT NULL,
  effective_from timestamptz NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, version)
);

-- Sucursales que participan en cada programa. Una sucursal pertenece a un solo programa.
CREATE TABLE program_branches (
  program_id uuid NOT NULL REFERENCES programs(id),
  branch_id uuid NOT NULL UNIQUE REFERENCES branches(id),
  PRIMARY KEY (program_id, branch_id)
);

-- Impide unir un programa con una sucursal de otra empresa.
CREATE FUNCTION check_program_branch_company() RETURNS trigger AS $$
BEGIN
  IF (SELECT company_id FROM programs WHERE id = NEW.program_id) IS DISTINCT FROM
     (SELECT company_id FROM branches WHERE id = NEW.branch_id) THEN
    RAISE EXCEPTION 'programa y sucursal pertenecen a empresas distintas';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER program_branches_company BEFORE INSERT OR UPDATE ON program_branches
  FOR EACH ROW EXECUTE FUNCTION check_program_branch_company();

CREATE TABLE rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id),
  name text NOT NULL,
  description text,
  cost int NOT NULL CHECK (cost > 0),
  pending_cost int CHECK (pending_cost IS NULL OR pending_cost > 0),
  pending_cost_from timestamptz,
  stock int CHECK (stock IS NULL OR stock >= 0),
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  role text NOT NULL CHECK (role IN ('owner','manager','employee')),
  branch_id uuid REFERENCES branches(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revoke_reason text
);
CREATE UNIQUE INDEX memberships_one_active ON memberships(user_id, company_id) WHERE status = 'active';

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text,
  email text CHECK (email IS NULL OR email = lower(email)),
  phone text,
  preferred_channel text NOT NULL DEFAULT 'none' CHECK (preferred_channel IN ('sms','whatsapp','email','none')),
  contact_verified_at timestamptz,
  privacy_accepted_at timestamptz,
  privacy_version text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_email_unique ON customers(email) WHERE email IS NOT NULL AND status = 'active';
CREATE UNIQUE INDEX customers_phone_unique ON customers(phone) WHERE phone IS NOT NULL AND status = 'active';

-- Permiso de publicidad: separado del uso de la tarjeta y por empresa.
CREATE TABLE marketing_consents (
  customer_id uuid NOT NULL REFERENCES customers(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  granted boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, company_id)
);

CREATE TABLE cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  program_id uuid NOT NULL REFERENCES programs(id),
  customer_id uuid REFERENCES customers(id),
  balance int NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','replaced','merged','closed')),
  format text NOT NULL DEFAULT 'web' CHECK (format IN ('web','printed')),
  issued_branch_id uuid REFERENCES branches(id),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  replaced_by uuid REFERENCES cards(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cards_one_active_per_customer ON cards(program_id, customer_id)
  WHERE status = 'active' AND customer_id IS NOT NULL;

CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  program_id uuid NOT NULL REFERENCES programs(id),
  card_id uuid NOT NULL REFERENCES cards(id),
  ticket_ref text NOT NULL CHECK (length(ticket_ref) BETWEEN 1 AND 60),
  amount_cents int CHECK (amount_cents IS NULL OR amount_cents >= 0),
  points int NOT NULL CHECK (points > 0),
  program_version int NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'counter' CHECK (source IN ('counter','contingency')),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','refunded')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  refunded_at timestamptz,
  refunded_by uuid REFERENCES users(id),
  refund_reason text
);
CREATE UNIQUE INDEX purchases_ticket_unique ON purchases(branch_id, lower(ticket_ref));
CREATE INDEX purchases_card ON purchases(card_id, created_at);
CREATE INDEX purchases_company ON purchases(company_id, created_at);

CREATE TABLE redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  program_id uuid NOT NULL REFERENCES programs(id),
  card_id uuid NOT NULL REFERENCES cards(id),
  reward_id uuid NOT NULL REFERENCES rewards(id),
  reward_name text NOT NULL,
  cost int NOT NULL CHECK (cost > 0),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','delivered','disputed','reversed')),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  delivered_by uuid REFERENCES users(id),
  dispute_note text,
  disputed_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id),
  resolution text
);
CREATE INDEX redemptions_company ON redemptions(company_id, created_at);

-- Historial de movimientos: solo se agregan filas. Las correcciones son movimientos nuevos.
CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  program_id uuid NOT NULL REFERENCES programs(id),
  card_id uuid NOT NULL REFERENCES cards(id),
  branch_id uuid REFERENCES branches(id),
  kind text NOT NULL CHECK (kind IN ('purchase','redemption','adjustment','refund','redemption_reversal','expiration','transfer_out','transfer_in')),
  points int NOT NULL CHECK (points <> 0),
  balance_after int NOT NULL CHECK (balance_after >= 0),
  purchase_id uuid REFERENCES purchases(id),
  redemption_id uuid REFERENCES redemptions(id),
  program_version int,
  reason text,
  actor_kind text NOT NULL CHECK (actor_kind IN ('staff','system','admin')),
  actor_user_id uuid REFERENCES users(id),
  related_entry_id bigint REFERENCES ledger_entries(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_card ON ledger_entries(card_id, id);
CREATE INDEX ledger_company ON ledger_entries(company_id, created_at);

CREATE FUNCTION forbid_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % solo admite agregar registros', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TABLE contingency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  card_code text NOT NULL,
  ticket_ref text NOT NULL,
  amount_cents int,
  occurred_at timestamptz NOT NULL,
  captured_by uuid NOT NULL REFERENCES users(id),
  captured_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','duplicate','rejected')),
  purchase_id uuid REFERENCES purchases(id),
  note text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz
);
CREATE UNIQUE INDEX contingency_ticket_unique ON contingency_records(branch_id, lower(ticket_ref)) WHERE status IN ('pending','applied');

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('staff','customer')),
  user_id uuid REFERENCES users(id),
  customer_id uuid REFERENCES customers(id),
  company_id uuid REFERENCES companies(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  ip text,
  user_agent text,
  CHECK ((kind = 'staff' AND user_id IS NOT NULL) OR (kind = 'customer' AND customer_id IS NOT NULL))
);
CREATE INDEX sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('register','login','redeem','holder')),
  channel text NOT NULL CHECK (channel IN ('sms','whatsapp','email')),
  destination text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  card_id uuid REFERENCES cards(id),
  payload jsonb,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_destination ON otp_codes(destination, created_at);

-- Mensajes salientes. Con el adaptador simulado no se envía nada: se guarda aquí para el buzón demo.
CREATE TABLE outbox_messages (
  id bigserial PRIMARY KEY,
  channel text NOT NULL,
  destination text NOT NULL,
  subject text,
  body text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_passes (
  card_id uuid NOT NULL REFERENCES cards(id),
  provider text NOT NULL CHECK (provider IN ('google','apple')),
  mode text NOT NULL CHECK (mode IN ('simulated','live')),
  displayed_balance int,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, provider)
);

-- Cola de actualización de Wallet. La tarea copia el saldo vigente; nunca suma puntos.
CREATE TABLE wallet_sync_jobs (
  id bigserial PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES cards(id),
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  synced_balance int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  company_id uuid PRIMARY KEY REFERENCES companies(id),
  plan text NOT NULL CHECK (plan IN ('basico','pro')),
  status text NOT NULL CHECK (status IN ('trial','active','past_due','suspended','cancelled')),
  monthly_price_cents int NOT NULL,
  installation_fee_cents int NOT NULL,
  paid_through date,
  grace_days int NOT NULL DEFAULT 7,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  concept text NOT NULL CHECK (concept IN ('instalacion','mensualidad','otro')),
  method text NOT NULL CHECK (method IN ('efectivo','transferencia','otro')),
  reference text,
  period_month text,
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id),
  kind text NOT NULL CHECK (kind IN ('soporte','falla','seguridad','disputa','datos','devolucion')),
  priority text NOT NULL CHECK (priority IN ('alta','media','baja')),
  status text NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','en_proceso','resuelto')),
  title text NOT NULL,
  description text,
  created_by uuid REFERENCES users(id),
  assigned_to text,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  company_id uuid REFERENCES companies(id),
  kind text NOT NULL CHECK (kind IN ('acceso','rectificacion','cancelacion','oposicion','baja_publicidad')),
  details text,
  status text NOT NULL DEFAULT 'recibida' CHECK (status IN ('recibida','en_proceso','atendida','rechazada')),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_kind text NOT NULL CHECK (actor_kind IN ('staff','customer','admin','system','public')),
  actor_id uuid,
  company_id uuid,
  action text NOT NULL,
  entity text,
  entity_id text,
  details jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_company ON audit_log(company_id, created_at);
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
