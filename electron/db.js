const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let db = null;
let dbPath = null;

const MIGRATIONS = [
  // v1 — estrutura inicial
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'vendedor',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    document TEXT,
    phone TEXT,
    email TEXT,
    contact TEXT,
    address TEXT,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    category TEXT,
    supplier_id INTEGER REFERENCES suppliers(id),
    cost_price REAL NOT NULL DEFAULT 0,
    sale_price REAL NOT NULL DEFAULT 0,
    min_stock INTEGER NOT NULL DEFAULT 2,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    color TEXT,
    size TEXT,
    barcode TEXT UNIQUE,
    stock INTEGER NOT NULL DEFAULT 0,
    min_stock INTEGER,
    cost_price REAL,
    sale_price REAL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_variants_product ON product_variants(product_id);

  CREATE TABLE stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id INTEGER NOT NULL REFERENCES product_variants(id),
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    unit_cost REAL,
    reference_type TEXT,
    reference_id INTEGER,
    notes TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_movements_variant ON stock_movements(variant_id, created_at);
  CREATE INDEX idx_movements_date ON stock_movements(created_at);

  CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cpf TEXT,
    phone TEXT,
    email TEXT,
    birth_date TEXT,
    address TEXT,
    city TEXT,
    credit_limit REAL NOT NULL DEFAULT 0,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE cash_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    opened_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    opening_amount REAL NOT NULL DEFAULT 0,
    closed_at TEXT,
    closed_by INTEGER REFERENCES users(id),
    counted_amount REAL,
    expected_amount REAL,
    difference REAL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'aberto'
  );

  CREATE TABLE cash_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
    type TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'dinheiro',
    amount REAL NOT NULL,
    description TEXT,
    reference_type TEXT,
    reference_id INTEGER,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_cashmov_session ON cash_movements(session_id);

  CREATE TABLE promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    value REAL NOT NULL,
    scope TEXT NOT NULL DEFAULT 'all',
    scope_value TEXT,
    start_date TEXT,
    end_date TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id),
    user_id INTEGER REFERENCES users(id),
    cash_session_id INTEGER REFERENCES cash_sessions(id),
    subtotal REAL NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    cost_total REAL NOT NULL DEFAULT 0,
    change_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'concluida',
    cancel_reason TEXT,
    canceled_at TEXT,
    canceled_by INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_sales_date ON sales(created_at);
  CREATE INDEX idx_sales_customer ON sales(customer_id);

  CREATE TABLE sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    variant_id INTEGER NOT NULL REFERENCES product_variants(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    unit_cost REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    returned_qty INTEGER NOT NULL DEFAULT 0,
    promotion_id INTEGER
  );
  CREATE INDEX idx_saleitems_sale ON sale_items(sale_id);
  CREATE INDEX idx_saleitems_variant ON sale_items(variant_id);

  CREATE TABLE sale_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    method TEXT NOT NULL,
    amount REAL NOT NULL,
    installments INTEGER NOT NULL DEFAULT 1,
    voucher_id INTEGER
  );
  CREATE INDEX idx_salepay_sale ON sale_payments(sale_id);

  CREATE TABLE installments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER REFERENCES sales(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    number INTEGER NOT NULL,
    total_numbers INTEGER NOT NULL,
    amount REAL NOT NULL,
    due_date TEXT NOT NULL,
    paid_amount REAL NOT NULL DEFAULT 0,
    paid_at TEXT,
    status TEXT NOT NULL DEFAULT 'aberta',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_inst_customer ON installments(customer_id);
  CREATE INDEX idx_inst_due ON installments(due_date);

  CREATE TABLE installment_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    installment_id INTEGER NOT NULL REFERENCES installments(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    amount REAL NOT NULL,
    interest REAL NOT NULL DEFAULT 0,
    method TEXT NOT NULL,
    cash_session_id INTEGER REFERENCES cash_sessions(id),
    user_id INTEGER REFERENCES users(id),
    receipt_group TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    customer_id INTEGER REFERENCES customers(id),
    amount REAL NOT NULL,
    balance REAL NOT NULL,
    return_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    customer_id INTEGER REFERENCES customers(id),
    type TEXT NOT NULL,
    total REAL NOT NULL,
    refund_method TEXT NOT NULL,
    voucher_id INTEGER,
    reason TEXT,
    user_id INTEGER REFERENCES users(id),
    cash_session_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL REFERENCES returns(id),
    sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
    variant_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    back_to_stock INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER REFERENCES suppliers(id),
    invoice_number TEXT,
    purchase_date TEXT NOT NULL,
    products_total REAL NOT NULL DEFAULT 0,
    freight REAL NOT NULL DEFAULT 0,
    other_costs REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'recebida',
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id),
    variant_id INTEGER NOT NULL REFERENCES product_variants(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_cost REAL NOT NULL,
    landed_unit_cost REAL NOT NULL,
    total REAL NOT NULL
  );
  CREATE INDEX idx_purchitems_product ON purchase_items(product_id);

  CREATE TABLE payables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id),
    purchase_id INTEGER REFERENCES purchases(id),
    category TEXT,
    expense_type TEXT NOT NULL DEFAULT 'variavel',
    amount REAL NOT NULL,
    due_date TEXT NOT NULL,
    paid_at TEXT,
    paid_amount REAL,
    payment_method TEXT,
    status TEXT NOT NULL DEFAULT 'aberta',
    installment_label TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_payables_due ON payables(due_date);

  CREATE TABLE receivables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    category TEXT,
    amount REAL NOT NULL,
    due_date TEXT NOT NULL,
    received_at TEXT,
    received_amount REAL,
    payment_method TEXT,
    status TEXT NOT NULL DEFAULT 'aberta',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE inventories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'aberto',
    filter_category TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    finished_at TEXT
  );

  CREATE TABLE inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_id INTEGER NOT NULL REFERENCES inventories(id),
    variant_id INTEGER NOT NULL REFERENCES product_variants(id),
    system_qty INTEGER NOT NULL,
    counted_qty INTEGER,
    UNIQUE(inventory_id, variant_id)
  );

  CREATE TABLE backup_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    destination TEXT NOT NULL,
    file TEXT,
    status TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  `,
];

function open(userDataDir) {
  const dir = path.join(userDataDir, 'dados');
  fs.mkdirSync(dir, { recursive: true });
  dbPath = path.join(dir, 'loja.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate();
  return db;
}

function migrate() {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

function close() {
  if (db) {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* ignora */ }
    db.close();
    db = null;
  }
}

function get() {
  if (!db) throw new Error('Banco de dados não inicializado');
  return db;
}

module.exports = { open, close, get, getPath: () => dbPath, schemaVersion: MIGRATIONS.length };
