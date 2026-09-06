const path = require('path');
const fs = require('fs');

let isPostgres = false;
let pgPool = null;
let sqliteDb = null;
let schemaInitialized = false;

const connectionString = process.env.DATABASE_URL || '';
if (connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://')) {
  isPostgres = true;
}

const DEFAULT_CITY_RATES = JSON.stringify([
  { city: "Lahore", rate: 200 },
  { city: "Karachi", rate: 250 },
  { city: "Islamabad", rate: 220 },
  { city: "Rawalpindi", rate: 220 },
  { city: "Faisalabad", rate: 220 },
  { city: "Peshawar", rate: 250 },
  { city: "Quetta", rate: 250 },
  { city: "Multan", rate: 220 },
  { city: "Sialkot", rate: 220 },
  { city: "Gujranwala", rate: 220 }
]);

function getSqliteDb() {
  if (!sqliteDb) {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.resolve(__dirname, '..', 'hs_thrift.db');
    sqliteDb = new DatabaseSync(dbPath);
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
  }
  return sqliteDb;
}

function getPostgresPool() {
  if (!pgPool) {
    let Pool;
    try {
      Pool = require('@neondatabase/serverless').Pool;
    } catch (e) {
      Pool = require('pg').Pool;
    }
    pgPool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pgPool;
}

function getPool() {
  if (isPostgres) {
    return getPostgresPool();
  }
  // Return SQLite mock pool supporting client transactions
  return {
    query: (text, params) => query(text, params),
    connect: async () => ({
      query: (text, params) => query(text, params),
      release: () => {}
    })
  };
}

async function ensureSchema() {
  if (schemaInitialized) return;

  if (isPostgres) {
    try {
      const p = getPostgresPool();
      await p.query(`
        CREATE TABLE IF NOT EXISTS admin_users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(150) UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role VARCHAR(50) DEFAULT 'admin',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS categories (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          slug VARCHAR(100) UNIQUE NOT NULL,
          description TEXT,
          image_url TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          name VARCHAR(200) NOT NULL,
          slug VARCHAR(200) UNIQUE NOT NULL,
          tagline VARCHAR(250),
          description TEXT,
          short_description TEXT,
          price INTEGER NOT NULL,
          sale_price INTEGER,
          image TEXT,
          image_url TEXT,
          stock_status BOOLEAN DEFAULT true,
          crafted_time_hours INTEGER DEFAULT 1,
          materials VARCHAR(200),
          dimensions VARCHAR(150),
          scent_notes VARCHAR(200),
          yarn_type VARCHAR(150),
          care_instructions TEXT,
          condition_rating VARCHAR(50) DEFAULT '9.5/10',
          size VARCHAR(50) DEFAULT 'M',
          is_featured BOOLEAN DEFAULT false,
          is_best_seller BOOLEAN DEFAULT false,
          is_new_arrival BOOLEAN DEFAULT false,
          is_archived BOOLEAN DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          order_id VARCHAR(50) UNIQUE NOT NULL,
          idempotency_key VARCHAR(100) UNIQUE,
          customer_name VARCHAR(150),
          customer_phone VARCHAR(50),
          customer_address TEXT,
          postal_code VARCHAR(20),
          city VARCHAR(100),
          order_notes TEXT,
          payment_method VARCHAR(20) DEFAULT 'COD',
          total_amount INTEGER DEFAULT 0,
          subtotal INTEGER DEFAULT 0,
          shipping_fee INTEGER DEFAULT 0,
          status VARCHAR(30) DEFAULT 'PENDING',
          order_status VARCHAR(30) DEFAULT 'PENDING',
          payment_status VARCHAR(30) DEFAULT 'UNPAID',
          items JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP WITH TIME ZONE,
          cancelled_at TIMESTAMP WITH TIME ZONE,
          payment_verified_at TIMESTAMP WITH TIME ZONE,
          payment_verified_by VARCHAR(150),
          payment_received_at TIMESTAMP WITH TIME ZONE,
          payment_received_by VARCHAR(150)
        );

        CREATE TABLE IF NOT EXISTS order_items (
          id SERIAL PRIMARY KEY,
          order_id VARCHAR(50),
          product_id INTEGER,
          product_name VARCHAR(200),
          quantity INTEGER NOT NULL DEFAULT 1,
          price INTEGER NOT NULL DEFAULT 0,
          subtotal INTEGER NOT NULL DEFAULT 0,
          image_url TEXT
        );

        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY DEFAULT 1,
          customer_data_retention_days INTEGER NOT NULL DEFAULT 45,
          standard_shipping_fee INTEGER NOT NULL DEFAULT 200,
          free_shipping_threshold INTEGER NOT NULL DEFAULT 3500,
          online_payment_instructions TEXT DEFAULT 'Please send payment screenshot on official WhatsApp (+92 319 715071) with your Order ID.',
          city_shipping_rates JSONB DEFAULT '${DEFAULT_CITY_RATES}',
          promo_popup_enabled BOOLEAN DEFAULT false,
          promo_popup_title TEXT,
          promo_popup_desc TEXT,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS whatsapp_notifications (
          id SERIAL PRIMARY KEY,
          order_id VARCHAR(50) NOT NULL,
          customer_phone VARCHAR(50),
          message_type VARCHAR(50) NOT NULL,
          message_content TEXT NOT NULL,
          order_status_at_send VARCHAR(50),
          payment_status_at_send VARCHAR(50),
          status VARCHAR(20) NOT NULL DEFAULT 'OPENED',
          sent_at TIMESTAMP WITH TIME ZONE,
          sent_by VARCHAR(150),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS order_audit_logs (
          id SERIAL PRIMARY KEY,
          order_id VARCHAR(50) NOT NULL,
          action_type VARCHAR(50) NOT NULL,
          old_value TEXT,
          new_value TEXT,
          performed_by VARCHAR(150) NOT NULL DEFAULT 'SYSTEM',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS testimonials (
          id SERIAL PRIMARY KEY,
          author_name VARCHAR(150) NOT NULL,
          content TEXT NOT NULL,
          role VARCHAR(100) DEFAULT 'Verified Buyer',
          rating INTEGER DEFAULT 5,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS contact_messages (
          id SERIAL PRIMARY KEY,
          name VARCHAR(150) NOT NULL,
          email VARCHAR(150) NOT NULL,
          subject VARCHAR(200),
          message TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS newsletter_subscribers (
          id SERIAL PRIMARY KEY,
          email VARCHAR(150) UNIQUE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO settings (id, customer_data_retention_days, standard_shipping_fee, free_shipping_threshold, online_payment_instructions, city_shipping_rates)
        VALUES (1, 45, 200, 3500, 'Please send payment screenshot on official WhatsApp (+92 319 715071) with your Order ID.', '${DEFAULT_CITY_RATES}')
        ON CONFLICT (id) DO NOTHING;
      `);
      schemaInitialized = true;
    } catch (err) {
      console.error('Failed to run schema migrations in Postgres:', err.message);
    }
    return;
  }

  // SQLite Schema Setup
  try {
    const db = getSqliteDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        image_url TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        tagline TEXT,
        description TEXT,
        short_description TEXT,
        price INTEGER NOT NULL,
        sale_price INTEGER,
        image TEXT,
        image_url TEXT,
        stock_status INTEGER DEFAULT 1,
        crafted_time_hours INTEGER DEFAULT 1,
        materials TEXT,
        dimensions TEXT,
        scent_notes TEXT,
        yarn_type TEXT,
        care_instructions TEXT,
        condition_rating TEXT DEFAULT '9.5/10',
        size TEXT DEFAULT 'M',
        is_featured INTEGER DEFAULT 0,
        is_best_seller INTEGER DEFAULT 0,
        is_new_arrival INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT UNIQUE NOT NULL,
        idempotency_key TEXT UNIQUE,
        customer_name TEXT,
        customer_phone TEXT,
        customer_address TEXT,
        postal_code TEXT,
        city TEXT,
        order_notes TEXT,
        payment_method TEXT DEFAULT 'COD',
        total_amount INTEGER DEFAULT 0,
        subtotal INTEGER DEFAULT 0,
        shipping_fee INTEGER DEFAULT 0,
        status TEXT DEFAULT 'PENDING',
        order_status TEXT DEFAULT 'PENDING',
        payment_status TEXT DEFAULT 'UNPAID',
        items TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        cancelled_at TEXT,
        payment_verified_at TEXT,
        payment_verified_by TEXT,
        payment_received_at TEXT,
        payment_received_by TEXT
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT,
        product_id INTEGER,
        product_name TEXT,
        quantity INTEGER NOT NULL DEFAULT 1,
        price INTEGER NOT NULL DEFAULT 0,
        subtotal INTEGER NOT NULL DEFAULT 0,
        image_url TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        customer_data_retention_days INTEGER NOT NULL DEFAULT 45,
        standard_shipping_fee INTEGER NOT NULL DEFAULT 200,
        free_shipping_threshold INTEGER NOT NULL DEFAULT 3500,
        online_payment_instructions TEXT,
        city_shipping_rates TEXT,
        promo_popup_enabled INTEGER DEFAULT 0,
        promo_popup_title TEXT,
        promo_popup_desc TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS whatsapp_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        customer_phone TEXT,
        message_type TEXT NOT NULL,
        message_content TEXT NOT NULL,
        order_status_at_send TEXT,
        payment_status_at_send TEXT,
        status TEXT DEFAULT 'OPENED',
        sent_at TEXT,
        sent_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS order_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        performed_by TEXT DEFAULT 'SYSTEM',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS testimonials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_name TEXT NOT NULL,
        content TEXT NOT NULL,
        role TEXT DEFAULT 'Verified Buyer',
        rating INTEGER DEFAULT 5,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS contact_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT,
        message TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure default settings row exists in SQLite
    const setRow = db.prepare('SELECT id FROM settings WHERE id = 1').get();
    if (!setRow) {
      db.prepare(`
        INSERT INTO settings (id, customer_data_retention_days, standard_shipping_fee, free_shipping_threshold, online_payment_instructions, city_shipping_rates)
        VALUES (1, 45, 200, 3500, 'Please send payment screenshot on official WhatsApp (+92 319 715071) with your Order ID.', ?)
      `).run(DEFAULT_CITY_RATES);
    }

    // Ensure default admin user exists (email: admin@hsthrift.com, pass: Admin@1234)
    const adminRow = db.prepare('SELECT id FROM admin_users WHERE email = ?').get('admin@hsthrift.com');
    if (!adminRow) {
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync('Admin@1234', 10);
      db.prepare(`
        INSERT INTO admin_users (email, password_hash, role)
        VALUES (?, ?, 'admin')
      `).run('admin@hsthrift.com', hash);
    }

    // Ensure default thrift categories exist
    const catCount = db.prepare('SELECT COUNT(*) as cnt FROM categories').get();
    if (catCount.cnt === 0) {
      const initialCategories = [
        { name: "Vintage Jackets & Outerwear", slug: "vintage-jackets", desc: "Curated 90s bomber jackets, windbreakers, varsity coats, and retro corduroy layers.", img: "https://images.unsplash.com/photo-1551028719-00167b16eac5?q=80&w=800&auto=format&fit=crop" },
        { name: "Streetwear Hoodies & Sweaters", slug: "graphic-hoodies", desc: "Heavyweight oversized hoodies, retro graphic crewnecks, and vintage knitwear.", img: "https://images.unsplash.com/photo-1556905055-8f358a7a47b2?q=80&w=800&auto=format&fit=crop" },
        { name: "Graphic & Vintage Tees", slug: "retro-tees", desc: "Authentic washed vintage tees, band prints, retro motorsport, and minimalist streetwear tees.", img: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?q=80&w=800&auto=format&fit=crop" },
        { name: "Cargo Pants & Vintage Denim", slug: "denim-bottoms", desc: "90s baggy skater jeans, tactical multi-pocket cargo pants, and washed vintage denim.", img: "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?q=80&w=800&auto=format&fit=crop" },
        { name: "Caps, Bags & Retro Accessories", slug: "thrift-accessories", desc: "Vintage trucker hats, crossbody messenger bags, retro sunglasses, and utility belts.", img: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?q=80&w=800&auto=format&fit=crop" }
      ];

      const insCat = db.prepare(`INSERT INTO categories (name, slug, description, image_url) VALUES (?, ?, ?, ?)`);
      for (const c of initialCategories) {
        insCat.run(c.name, c.slug, c.desc, c.img);
      }
    }

    // Ensure initial thrift reviews / testimonials
    const tCount = db.prepare('SELECT COUNT(*) as cnt FROM testimonials').get();
    if (tCount.cnt === 0) {
      const insT = db.prepare(`INSERT INTO testimonials (author_name, content, role, rating) VALUES (?, ?, ?, ?)`);
      insT.run('Hamza Tariq, Lahore', 'Ordered a 90s vintage windbreaker. Quality was literally 10/10 like brand new, but at 1/5th of the retail price! Arrived steamed and smelling fresh.', 'Verified Buyer', 5);
      insT.run('Zainab Ali, Karachi', 'The oversized graphic hoodie is insane quality. Heavyweight fleece, perfect boxy fit, and ordering via WhatsApp took 30 seconds.', 'Streetwear Enthusiast', 5);
      insT.run('Bilal Khan, Islamabad', 'Best thrift store in Pakistan hands down. No ripped junk—every single piece is handpicked, clean, and priced so fairly. 100% recommended!', 'Verified Buyer', 5);
    }

    schemaInitialized = true;
  } catch (err) {
    console.error('Failed to run schema migrations in SQLite:', err);
  }
}

/**
 * Universal query runner: executes against PostgreSQL or SQLite
 */
async function query(text, params = []) {
  if (!schemaInitialized) {
    await ensureSchema();
  }

  if (isPostgres) {
    const p = getPostgresPool();
    const res = await p.query(text, params);
    return res;
  }

  // SQLite execution
  const db = getSqliteDb();

  // No-op Postgres-only calls like setval()
  if (text.includes('setval(')) {
    return { rows: [], rowCount: 0 };
  }

  // Translate PostgreSQL syntax to SQLite
  let sql = text;
  sql = sql.replace(/\bFOR UPDATE\b/gi, '');
  sql = sql.replace(/::[a-zA-Z]+/g, '');
  sql = sql.replace(/\bILIKE\b/gi, 'LIKE');
  sql = sql.replace(/\bJSONB\b/gi, 'TEXT');
  sql = sql.replace(/\bNOW\(\)\b/gi, "datetime('now')");

  // Handle ANY($n) and parameter conversion
  const newParams = [];
  const regex = /(=\s*ANY\s*\(\s*\$(\d+)\s*\))|(\$(\d+))/gi;

  if (regex.test(sql)) {
    sql = sql.replace(regex, (match, anyMatch, anyIdx, singleMatch, singleIdx) => {
      if (anyMatch) {
        const idx = parseInt(anyIdx, 10) - 1;
        const arr = Array.isArray(params[idx]) ? params[idx] : [params[idx]];
        if (!arr || arr.length === 0) return 'IN (NULL)';
        arr.forEach(val => newParams.push(val));
        return 'IN (' + arr.map(() => '?').join(', ') + ')';
      } else {
        const idx = parseInt(singleIdx, 10) - 1;
        newParams.push(params[idx]);
        return '?';
      }
    });
  } else {
    // If query uses ? or has no placeholders
    params.forEach(p => newParams.push(p));
  }

  const trimmed = sql.trim();
  const isSelect = /^(SELECT|PRAGMA)/i.test(trimmed);

  try {
    const stmt = db.prepare(sql);

    // Normalize params: convert boolean to 1/0 or objects to string
    const normalizedParams = newParams.map(p => {
      if (typeof p === 'boolean') return p ? 1 : 0;
      if (typeof p === 'object' && p !== null) return JSON.stringify(p);
      return p;
    });

    if (isSelect || /RETURNING/i.test(trimmed)) {
      const rows = stmt.all(...normalizedParams);
      const mappedRows = rows.map(r => {
        const obj = {};
        for (const [k, v] of Object.entries(r)) {
          if (['stock_status', 'is_featured', 'is_best_seller', 'is_new_arrival', 'is_archived', 'promo_popup_enabled'].includes(k)) {
            obj[k] = Boolean(v);
          } else {
            obj[k] = v;
          }
        }
        return obj;
      });
      return { rows: mappedRows, rowCount: mappedRows.length };
    } else {
      const info = stmt.run(...normalizedParams);
      return {
        rows: [],
        rowCount: info.changes,
        lastInsertRowid: info.lastInsertRowid
      };
    }
  } catch (err) {
    console.error('SQLite query error:', err.message, '\nQuery was:\n', sql, '\nParams:', normalizedParams || params);
    throw err;
  }
}

module.exports = {
  query,
  getPool,
  ensureSchema
};
