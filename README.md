# Celeiros

Mini-app para moradores sugerirem produtos e votarem.

## Cores do site

- Primária: `#783219`
- Fundo: `#fff8e9`

## Login (Nome + Bloco + Apartamento)

O acesso é feito por **Nome completo + Bloco + Nº do apartamento**.

- Ao clicar **Entrar**, o servidor:
  - procura um morador com o mesmo **Nome+Bloco+Apartamento**
  - se não existir, **cria automaticamente**
  - cria uma sessão via cookie `celeiros_sid`
- A opção **“Lembrar-me neste dispositivo”** estende a sessão para **30 dias** (senão, 7 dias).
- O campo **Apartamento** aceita **apenas números** (validado no front e no servidor).

Arquivos:

- Tela de login: `Celeiros/login.html`
- Página principal: `Celeiros/index.html` (se não estiver autenticado, redireciona para o login)

## Banco de dados (SQLite)

O banco é um SQLite criado automaticamente pelo servidor.

- Arquivo do banco: `Celeiros/server/data/celeiros.sqlite`
- Esquema: `Celeiros/server/schema.sql`

Tabelas principais:

- `users`: moradores (nome, bloco, apartamento)
- `products`: produtos sugeridos
- `product_votes`: votos/curtidas por usuário
- `sessions`: sessões (cookie)

### Se você mudou o schema e já tinha um banco antigo

Como o schema está em evolução, pode ser necessário **apagar o SQLite** e deixar o servidor recriar:

- apague `Celeiros/server/data/celeiros.sqlite`
- inicie o servidor de novo

## Servidor (API)

O servidor está em `Celeiros/server/` e serve também os arquivos estáticos do projeto.

### Rodar localmente

1) Instale o Node.js (LTS)

2) No terminal:

```bash
cd "Celeiros/server"
npm install
npm run dev
```

3) Abra:

- `http://localhost:3000/` (redireciona para `Celeiros/index.html`)
- `http://localhost:3000/Celeiros/login.html`

### Endpoints

Autenticação:

- `GET /api/me` → `{ authenticated: boolean }`
- `POST /api/auth/login` → cria/acha morador e cria sessão
  - body: `{ nomeCompleto, bloco, apartamento, lembrar }`
- `POST /api/logout` → encerra sessão

Produtos:

- `GET /api/produtos`
- `POST /api/produtos` body: `{ nome }`
- `PATCH /api/produtos/:id` body: `{ nome }` (apenas quem criou)
- `DELETE /api/produtos/:id` (apenas quem criou)
- `POST /api/produtos/:id/toggle-like`

# Celeiros, Criando um sistema funcional aos poucos