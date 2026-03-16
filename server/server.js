const path = require('path');
const express = require('express');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const { openDb, initSchema, ensureUser, run, get, all } = require('./db');

function createApp({ db }) {
  const app = express();

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // Permite abrir o HTML via http://localhost sem dor de cabeça.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  function getClientId(req) {
    const fromQuery = req.query && req.query.client_id;
    if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim();
    const fromHeader = req.header('x-client-id');
    if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();
    return null;
  }

  async function getUserBySession(req) {
    const sid = req.cookies && req.cookies.celeiros_sid;
    if (!sid || typeof sid !== 'string') return null;

    const row = await get(
      db,
      `
      SELECT u.id, u.client_id
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > datetime('now')
      `,
      [sid],
    );
    return row || null;
  }

  async function getUser(req) {
    const bySession = await getUserBySession(req);
    if (bySession) return bySession;

    throw Object.assign(new Error('Não autenticado.'), { status: 401 });
  }

  function normalizeName(name) {
    if (typeof name !== 'string') return '';
    return name.trim().replace(/\s+/g, ' ');
  }

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/me', async (req, res, next) => {
    try {
      const bySession = await getUserBySession(req);
      res.json({ authenticated: !!bySession });
    } catch (err) {
      next(err);
    }
  });

  function normalizeFullName(name) {
    if (typeof name !== 'string') return '';
    return name.trim().replace(/\s+/g, ' ');
  }

  function normalizeApartment(ap) {
    if (ap === null || ap === undefined) return '';
    const v = String(ap).trim();
    if (!v) return '';
    if (!/^\d+$/.test(v)) return '';
    return v;
  }

  function normalizeBlock(b) {
    if (b === null || b === undefined) return '';
    return String(b).trim().replace(/\s+/g, ' ');
  }

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const fullName = normalizeFullName(req.body && req.body.nomeCompleto);
      const apartmentNumber = normalizeApartment(req.body && req.body.apartamento);
      const block = normalizeBlock(req.body && req.body.bloco);
      const lembrar = !!(req.body && req.body.lembrar);
      if (!fullName) return res.status(400).json({ error: 'Informe o nome completo.' });
      if (!block) return res.status(400).json({ error: 'Informe o bloco.' });
      if (!apartmentNumber) return res.status(400).json({ error: 'Informe um número de apartamento válido (apenas números).' });

      let user = await get(
        db,
        `
        SELECT id
        FROM users
        WHERE lower(trim(full_name)) = lower(trim(?))
          AND lower(trim(block)) = lower(trim(?))
          AND trim(apartment_number) = trim(?)
        `,
        [fullName, block, apartmentNumber],
      );

      // Se não existir, cria automaticamente
      if (!user) {
        const clientId = `local:${crypto.randomUUID()}`;
        try {
          await run(
            db,
            `INSERT INTO users (client_id, full_name, block, apartment_number) VALUES (?, ?, ?, ?)`,
            [clientId, fullName, block, apartmentNumber],
          );
        } catch (err) {
          // Se houve corrida e alguém criou ao mesmo tempo, só continua buscando
          if (!(err && String(err.message || '').toLowerCase().includes('unique'))) throw err;
        }

        user = await get(
          db,
          `
          SELECT id
          FROM users
          WHERE lower(trim(full_name)) = lower(trim(?))
            AND lower(trim(block)) = lower(trim(?))
            AND trim(apartment_number) = trim(?)
          `,
          [fullName, block, apartmentNumber],
        );
      }

      if (!user) return res.status(500).json({ error: 'Falha ao criar/encontrar morador.' });

      const sid = crypto.randomUUID();
      const ttlDays = lembrar ? 30 : 7;
      await run(
        db,
        `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`,
        [sid, user.id, `+${ttlDays} days`],
      );

      res.cookie('celeiros_sid', sid, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: ttlDays * 24 * 60 * 60 * 1000,
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/logout', async (req, res, next) => {
    try {
      const sid = req.cookies && req.cookies.celeiros_sid;
      if (sid && typeof sid === 'string') {
        await run(db, `DELETE FROM sessions WHERE id = ?`, [sid]);
      }
      res.clearCookie('celeiros_sid', { path: '/' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/produtos', async (req, res, next) => {
    try {
      const user = await getUser(req);

      const rows = await all(
        db,
        `
        SELECT
          p.id,
          p.name AS nome,
          p.created_by_user_id AS createdByUserId,
          COALESCE(v.cnt, 0) AS votos,
          CASE WHEN myv.user_id IS NULL THEN 0 ELSE 1 END AS curtidoPorMim
        FROM products p
        LEFT JOIN (
          SELECT product_id, COUNT(*) AS cnt
          FROM product_votes
          GROUP BY product_id
        ) v ON v.product_id = p.id
        LEFT JOIN product_votes myv
          ON myv.product_id = p.id AND myv.user_id = ?
        WHERE p.deleted_at IS NULL
        ORDER BY votos DESC, p.created_at DESC
        `,
        [user.id],
      );

      res.json({
        produtos: rows.map((r) => ({
          id: r.id,
          nome: r.nome,
          votos: Number(r.votos) || 0,
          curtidoPorMim: !!r.curtidoPorMim,
          meu: r.createdByUserId === user.id,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/produtos', async (req, res, next) => {
    try {
      const user = await getUser(req);
      const nome = normalizeName(req.body && req.body.nome);
      if (!nome) return res.status(400).json({ error: 'O nome não pode ficar em branco.' });

      // Cria o produto
      const ins = await run(
        db,
        `INSERT INTO products (name, created_by_user_id) VALUES (?, ?)`,
        [nome, user.id],
      );

      // Primeira curtida/voto é automática (mesmo comportamento do seu HTML atual)
      await run(db, `INSERT INTO product_votes (product_id, user_id) VALUES (?, ?)`, [ins.lastID, user.id]);

      const row = await get(
        db,
        `
        SELECT p.id, p.name AS nome,
          (SELECT COUNT(*) FROM product_votes pv WHERE pv.product_id = p.id) AS votos
        FROM products p
        WHERE p.id = ?`,
        [ins.lastID],
      );

      res.status(201).json({
        produto: {
          id: row.id,
          nome: row.nome,
          votos: Number(row.votos) || 0,
          curtidoPorMim: true,
          meu: true,
        },
      });
    } catch (err) {
      // Unique index de nome
      if (err && String(err.message || '').toLowerCase().includes('unique')) {
        return res.status(409).json({ error: 'Já existe um produto com esse nome.' });
      }
      next(err);
    }
  });

  app.patch('/api/produtos/:id', async (req, res, next) => {
    try {
      const user = await getUser(req);
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido.' });

      const nome = normalizeName(req.body && req.body.nome);
      if (!nome) return res.status(400).json({ error: 'O nome não pode ficar em branco.' });

      const prod = await get(db, `SELECT id, created_by_user_id AS createdBy FROM products WHERE id = ? AND deleted_at IS NULL`, [id]);
      if (!prod) return res.status(404).json({ error: 'Produto não encontrado.' });
      if (prod.createdBy !== user.id) return res.status(403).json({ error: 'Você só pode editar produtos criados por você.' });

      await run(db, `UPDATE products SET name = ? WHERE id = ?`, [nome, id]);
      res.json({ ok: true });
    } catch (err) {
      if (err && String(err.message || '').toLowerCase().includes('unique')) {
        return res.status(409).json({ error: 'Já existe um produto com esse nome.' });
      }
      next(err);
    }
  });

  app.delete('/api/produtos/:id', async (req, res, next) => {
    try {
      const user = await getUser(req);
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido.' });

      const prod = await get(db, `SELECT id, created_by_user_id AS createdBy FROM products WHERE id = ? AND deleted_at IS NULL`, [id]);
      if (!prod) return res.status(404).json({ error: 'Produto não encontrado.' });
      if (prod.createdBy !== user.id) return res.status(403).json({ error: 'Você só pode excluir produtos criados por você.' });

      await run(db, `UPDATE products SET deleted_at = datetime('now') WHERE id = ?`, [id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/produtos/:id/toggle-like', async (req, res, next) => {
    try {
      const user = await getUser(req);
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido.' });

      const prod = await get(db, `SELECT id FROM products WHERE id = ? AND deleted_at IS NULL`, [id]);
      if (!prod) return res.status(404).json({ error: 'Produto não encontrado.' });

      const exists = await get(
        db,
        `SELECT 1 AS ok FROM product_votes WHERE product_id = ? AND user_id = ?`,
        [id, user.id],
      );

      if (exists) {
        await run(db, `DELETE FROM product_votes WHERE product_id = ? AND user_id = ?`, [id, user.id]);
      } else {
        await run(db, `INSERT INTO product_votes (product_id, user_id) VALUES (?, ?)`, [id, user.id]);
      }

      const votosRow = await get(db, `SELECT COUNT(*) AS votos FROM product_votes WHERE product_id = ?`, [id]);
      res.json({ curtidoPorMim: !exists, votos: Number(votosRow.votos) || 0 });
    } catch (err) {
      next(err);
    }
  });

  // Serve o projeto (inclui seu HTML)
  // server/ fica dentro de Celeiros/, então a raiz do projeto é dois níveis acima
  // (onde existe a pasta /Celeiros).
  const projectRoot = path.join(__dirname, '..', '..');
  app.use(express.static(projectRoot));

  // Página inicial (abre o Celeiros)
  app.get('/', (req, res) => {
    res.redirect('/Celeiros/index.html');
  });

  // Mantém consistência: /Celeiros/ -> /Celeiros/index.html
  app.get('/Celeiros/', (req, res) => {
    res.redirect('/Celeiros/index.html');
  });

  // Tratamento de erro
  app.use((err, req, res, next) => {
    const status = err && err.status ? err.status : 500;
    const msg = status === 500 ? 'Erro interno.' : err.message;
    if (status === 500) {
      const id = crypto.randomUUID();
      // log mínimo no server
      console.error(`[${id}]`, err);
      return res.status(500).json({ error: msg, id });
    }
    res.status(status).json({ error: msg });
  });

  return app;
}

async function main() {
  const { db, dbPath } = openDb();
  await initSchema(db);

  const app = createApp({ db });
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Celeiros server em http://localhost:${port}`);
    console.log(`SQLite: ${dbPath}`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp };

