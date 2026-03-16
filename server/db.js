const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function openDb() {
  const dataDir = path.join(__dirname, 'data');
  ensureDir(dataDir);

  const dbPath = path.join(dataDir, 'celeiros.sqlite');
  const db = new sqlite3.Database(dbPath);
  db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON;');
    db.run('PRAGMA busy_timeout = 5000;');
  });
  return { db, dbPath };
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initSchema(db) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await new Promise((resolve, reject) => {
    db.exec(schemaSql, (err) => (err ? reject(err) : resolve()));
  });
}

async function ensureUser(db, clientId) {
  if (!clientId || typeof clientId !== 'string') throw Object.assign(new Error('client_id inválido'), { status: 400 });
  const normalized = clientId.trim();
  if (!normalized) throw Object.assign(new Error('client_id inválido'), { status: 400 });

  await run(
    db,
    `INSERT INTO users (client_id)
     VALUES (?)
     ON CONFLICT(client_id) DO NOTHING`,
    [normalized],
  );

  const row = await get(db, `SELECT id, client_id FROM users WHERE client_id = ?`, [normalized]);
  return row;
}

module.exports = {
  openDb,
  initSchema,
  ensureUser,
  run,
  get,
  all,
};

