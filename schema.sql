-- Palm Ledger: proposed SQLite bootstrap schema, not an applied production migration.
-- Target: SQLite >= 3.37 with JSON functions. Each connection must enable foreign keys.
-- Application service must validate allocation completeness, financial formulas,
-- expected versions, owner access and idempotency inside the same write transaction.
-- Money: integer satang. Quantity: integer thousandths of kg/day/bag.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

BEGIN IMMEDIATE;

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE gardens (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    opening_net_minor INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE UNIQUE INDEX gardens_active_name ON gardens (name) WHERE archived_at IS NULL;

CREATE TABLE parties (
    id TEXT PRIMARY KEY NOT NULL,
    party_type TEXT NOT NULL CHECK (party_type IN ('worker', 'team', 'supplier', 'buyer', 'other')),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    default_daily_rate_minor INTEGER CHECK (default_daily_rate_minor > 0),
    default_ton_rate_minor INTEGER CHECK (default_ton_rate_minor > 0),
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE ledger_entries (
    id TEXT PRIMARY KEY NOT NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('sale', 'expense', 'opening_debt')),
    garden_id TEXT REFERENCES gardens(id) ON DELETE RESTRICT,
    party_id TEXT REFERENCES parties(id) ON DELETE RESTRICT,
    counterparty_name TEXT NOT NULL DEFAULT '',
    business_date TEXT NOT NULL CHECK (
        length(business_date) = 10 AND
        business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND
        date(business_date, '+0 days') IS NOT NULL AND
        date(business_date, '+0 days') = business_date
    ),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
    category TEXT NOT NULL CHECK (category IN (
        'sale', 'daily', 'production', 'fertilizer', 'materials', 'maintenance', 'other'
    )),
    amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 99999999999),
    quantity_milli INTEGER CHECK (quantity_milli > 0),
    quantity_unit TEXT CHECK (quantity_unit IN ('kg', 'day', 'bag')),
    rate_minor INTEGER CHECK (rate_minor BETWEEN 1 AND 99999999999),
    receipt_number TEXT NOT NULL DEFAULT '',
    linked_sale_id TEXT REFERENCES ledger_entries(id) ON DELETE RESTRICT,
    note TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    voided_at TEXT,
    void_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (entry_type = 'expense' OR garden_id IS NOT NULL),
    CHECK ((entry_type = 'sale' AND category = 'sale') OR
           (entry_type <> 'sale' AND category <> 'sale')),
    CHECK (entry_type <> 'sale' OR
           (quantity_milli IS NOT NULL AND quantity_unit IS 'kg' AND rate_minor IS NOT NULL)),
    CHECK (entry_type <> 'expense' OR category <> 'daily' OR
           (quantity_milli IS NOT NULL AND quantity_milli % 500 = 0 AND quantity_unit IS 'day' AND rate_minor IS NOT NULL)),
    CHECK (entry_type <> 'expense' OR category <> 'production' OR
           (quantity_milli IS NOT NULL AND quantity_unit IS 'kg' AND rate_minor IS NOT NULL)),
    CHECK (category <> 'fertilizer' OR garden_id IS NOT NULL),
    CHECK (entry_type <> 'expense' OR category <> 'fertilizer' OR
           (quantity_milli IS NOT NULL AND quantity_unit IS 'bag' AND rate_minor IS NOT NULL)),
    CHECK (linked_sale_id IS NULL OR
           (entry_type = 'expense' AND category = 'production' AND linked_sale_id <> id)),
    CHECK (voided_at IS NULL OR length(trim(coalesce(void_reason, ''))) > 0)
) STRICT;

CREATE INDEX entries_garden_date ON ledger_entries (garden_id, business_date DESC) WHERE voided_at IS NULL;
CREATE INDEX entries_kind_date ON ledger_entries (entry_type, business_date DESC) WHERE voided_at IS NULL;
CREATE INDEX entries_party ON ledger_entries (party_id) WHERE voided_at IS NULL;
CREATE INDEX entries_duplicate_hint ON ledger_entries (business_date, garden_id, amount_minor, counterparty_name)
    WHERE entry_type = 'sale' AND voided_at IS NULL;

CREATE TABLE sale_deductions (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE RESTRICT,
    label TEXT NOT NULL CHECK (length(trim(label)) > 0),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0)
) STRICT;

CREATE INDEX deductions_entry ON sale_deductions (entry_id);

CREATE TABLE expense_payments (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE RESTRICT,
    payment_date TEXT NOT NULL CHECK (
        length(payment_date) = 10 AND
        payment_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND
        date(payment_date, '+0 days') IS NOT NULL AND date(payment_date, '+0 days') = payment_date
    ),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    note TEXT NOT NULL DEFAULT '',
    voided_at TEXT,
    void_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (voided_at IS NULL OR length(trim(coalesce(void_reason, ''))) > 0)
) STRICT;

CREATE INDEX payments_entry ON expense_payments (entry_id) WHERE voided_at IS NULL;

CREATE TABLE expense_allocations (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE RESTRICT,
    garden_id TEXT NOT NULL REFERENCES gardens(id) ON DELETE RESTRICT,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (entry_id, garden_id),
    UNIQUE (entry_id, sort_order)
) STRICT;

CREATE INDEX allocations_garden ON expense_allocations (garden_id, entry_id);

CREATE TABLE receipt_files (
    id TEXT PRIMARY KEY NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX receipts_checksum ON receipt_files (sha256);

CREATE TABLE receipt_links (
    receipt_id TEXT NOT NULL REFERENCES receipt_files(id) ON DELETE RESTRICT,
    entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE RESTRICT,
    PRIMARY KEY (receipt_id, entry_id)
) STRICT;

CREATE TABLE ocr_drafts (
    id TEXT PRIMARY KEY NOT NULL,
    receipt_id TEXT NOT NULL REFERENCES receipt_files(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'needs_review', 'confirmed', 'failed')),
    provider TEXT,
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    confidence_json TEXT CHECK (confidence_json IS NULL OR json_valid(confidence_json)),
    error_code TEXT,
    confirmed_entry_id TEXT REFERENCES ledger_entries(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK ((status = 'confirmed' AND confirmed_entry_id IS NOT NULL) OR
           (status <> 'confirmed' AND confirmed_entry_id IS NULL))
) STRICT;

CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
    after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX audit_entity ON audit_events (entity_type, entity_id, id);

CREATE TABLE idempotency_requests (
    scope TEXT NOT NULL,
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL CHECK (response_status BETWEEN 200 AND 299),
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (scope, request_key)
) STRICT;

-- Guards enforce row-level invariants; the service also validates them and maps
-- constraint errors to domain errors. SQLite serializes writes in the transaction.
CREATE TRIGGER payment_insert_guard BEFORE INSERT ON expense_payments
WHEN NEW.voided_at IS NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM ledger_entries e WHERE e.id = NEW.entry_id
        AND e.entry_type IN ('expense', 'opening_debt') AND e.voided_at IS NULL
    ) THEN RAISE(ABORT, 'payment_requires_active_expense') END;
    SELECT CASE WHEN NEW.amount_minor + coalesce((
        SELECT sum(p.amount_minor) FROM expense_payments p
        WHERE p.entry_id = NEW.entry_id AND p.voided_at IS NULL
    ), 0) > (SELECT amount_minor FROM ledger_entries WHERE id = NEW.entry_id)
    THEN RAISE(ABORT, 'payment_exceeds_outstanding') END;
END;

CREATE TRIGGER payment_update_guard BEFORE UPDATE ON expense_payments
WHEN NEW.voided_at IS NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM ledger_entries e WHERE e.id = NEW.entry_id
        AND e.entry_type IN ('expense', 'opening_debt') AND e.voided_at IS NULL
    ) THEN RAISE(ABORT, 'payment_requires_active_expense') END;
    SELECT CASE WHEN NEW.amount_minor + coalesce((
        SELECT sum(p.amount_minor) FROM expense_payments p
        WHERE p.entry_id = NEW.entry_id AND p.id <> OLD.id AND p.voided_at IS NULL
    ), 0) > (SELECT amount_minor FROM ledger_entries WHERE id = NEW.entry_id)
    THEN RAISE(ABORT, 'payment_exceeds_outstanding') END;
END;

CREATE TRIGGER allocation_insert_guard BEFORE INSERT ON expense_allocations
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM ledger_entries e WHERE e.id = NEW.entry_id
        AND e.entry_type = 'expense' AND e.garden_id IS NULL AND e.voided_at IS NULL
    ) THEN RAISE(ABORT, 'allocation_requires_active_shared_expense') END;
    SELECT CASE WHEN NEW.amount_minor + coalesce((
        SELECT sum(a.amount_minor) FROM expense_allocations a WHERE a.entry_id = NEW.entry_id
    ), 0) > (SELECT amount_minor FROM ledger_entries WHERE id = NEW.entry_id)
    THEN RAISE(ABORT, 'allocations_exceed_expense') END;
END;

CREATE TRIGGER allocation_update_guard BEFORE UPDATE ON expense_allocations
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM ledger_entries e WHERE e.id = NEW.entry_id
        AND e.entry_type = 'expense' AND e.garden_id IS NULL AND e.voided_at IS NULL
    ) THEN RAISE(ABORT, 'allocation_requires_active_shared_expense') END;
    SELECT CASE WHEN NEW.amount_minor + coalesce((
        SELECT sum(a.amount_minor) FROM expense_allocations a
        WHERE a.entry_id = NEW.entry_id AND a.id <> OLD.id
    ), 0) > (SELECT amount_minor FROM ledger_entries WHERE id = NEW.entry_id)
    THEN RAISE(ABORT, 'allocations_exceed_expense') END;
END;

CREATE TRIGGER entry_update_guard BEFORE UPDATE ON ledger_entries
BEGIN
    SELECT CASE WHEN coalesce((
        SELECT sum(p.amount_minor) FROM expense_payments p
        WHERE p.entry_id = OLD.id AND p.voided_at IS NULL
    ), 0) > NEW.amount_minor THEN RAISE(ABORT, 'expense_below_paid_total') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM expense_payments p WHERE p.entry_id = OLD.id AND p.voided_at IS NULL
    ) AND (NEW.entry_type = 'sale' OR NEW.voided_at IS NOT NULL)
    THEN RAISE(ABORT, 'cancel_payments_before_voiding_expense') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM expense_allocations a WHERE a.entry_id = OLD.id
    ) AND (NEW.entry_type <> 'expense' OR NEW.garden_id IS NOT NULL)
    THEN RAISE(ABORT, 'allocated_entry_must_remain_shared_expense') END;
    SELECT CASE WHEN coalesce((
        SELECT sum(a.amount_minor) FROM expense_allocations a WHERE a.entry_id = OLD.id
    ), 0) > NEW.amount_minor THEN RAISE(ABORT, 'expense_below_allocated_total') END;
END;

CREATE TRIGGER deduction_insert_guard BEFORE INSERT ON sale_deductions
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM ledger_entries e WHERE e.id = NEW.entry_id
        AND e.entry_type = 'sale' AND e.voided_at IS NULL
    ) THEN RAISE(ABORT, 'deduction_requires_active_sale') END;
END;

CREATE TRIGGER deduction_update_guard BEFORE UPDATE ON sale_deductions
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM ledger_entries e WHERE e.id = NEW.entry_id
        AND e.entry_type = 'sale' AND e.voided_at IS NULL
    ) THEN RAISE(ABORT, 'deduction_requires_active_sale') END;
END;

CREATE VIEW entry_payment_totals AS
SELECT e.id AS entry_id,
       coalesce(sum(p.amount_minor), 0) AS paid_minor,
       e.amount_minor - coalesce(sum(p.amount_minor), 0) AS pending_minor
FROM ledger_entries e
LEFT JOIN expense_payments p ON p.entry_id = e.id AND p.voided_at IS NULL
WHERE e.entry_type IN ('expense', 'opening_debt') AND e.voided_at IS NULL
GROUP BY e.id, e.amount_minor;

-- Active garden amounts: allocation rows attribute existing costs, never add costs.
CREATE VIEW garden_entry_amounts AS
SELECT e.id AS entry_id, e.garden_id, e.business_date, e.entry_type, e.amount_minor
FROM ledger_entries e
WHERE e.garden_id IS NOT NULL AND e.voided_at IS NULL
UNION ALL
SELECT e.id AS entry_id, a.garden_id, e.business_date, e.entry_type, a.amount_minor
FROM ledger_entries e
JOIN expense_allocations a ON a.entry_id = e.id
WHERE e.garden_id IS NULL AND e.entry_type = 'expense' AND e.voided_at IS NULL;

CREATE VIEW garden_net_totals AS
SELECT g.id AS garden_id, g.name, g.opening_net_minor,
       coalesce(sum(CASE WHEN a.entry_type = 'sale' THEN a.amount_minor ELSE 0 END), 0) AS income_minor,
       coalesce(sum(CASE WHEN a.entry_type = 'expense' THEN a.amount_minor ELSE 0 END), 0) AS expense_minor,
       g.opening_net_minor + coalesce(sum(CASE
           WHEN a.entry_type = 'sale' THEN a.amount_minor
           WHEN a.entry_type = 'expense' THEN -a.amount_minor
           ELSE 0 END), 0) AS net_minor
FROM gardens g
LEFT JOIN garden_entry_amounts a ON a.garden_id = g.id
GROUP BY g.id, g.name, g.opening_net_minor;

CREATE VIEW shared_unallocated_totals AS
SELECT coalesce(sum(e.amount_minor - coalesce(a.allocated_minor, 0)), 0) AS expense_minor
FROM ledger_entries e
LEFT JOIN (
    SELECT entry_id, sum(amount_minor) AS allocated_minor
    FROM expense_allocations GROUP BY entry_id
) a ON a.entry_id = e.id
WHERE e.garden_id IS NULL AND e.entry_type = 'expense' AND e.voided_at IS NULL;

INSERT INTO schema_migrations (version) VALUES (1);

COMMIT;
