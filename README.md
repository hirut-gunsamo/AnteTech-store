# AnteTech

Store management for a phone and accessories business: one main store that receives all stock, and selling stores that get goods by transfer.

- **Owner:** manages products and stock, sends transfers, approves requests and cash reports, verifies bank deposits, runs payroll and commission, and reads every store's reports.
- **Sales:** sell (phones by IMEI or serial, accessories by count), request restocks, receive deliveries, record deposits, expenses and deductions. A seller sees only their own store's data.

English and Amharic. Works as an installable app on phones.

## Project layout

| Folder | What it is |
|---|---|
| `apps/api` | The server: Fastify, Prisma, zod |
| `apps/web` | The website: React, Vite, TypeScript |
| `packages/database` | The database schema, migrations and seed (PostgreSQL) |

## Setup

You need Node.js, pnpm and PostgreSQL.

1. Create a database, then the two settings files from their examples. Fill in your database user and password, and a long random `JWT_SECRET` (for example from `openssl rand -base64 48`). Do this before installing: the install prepares the database code, which needs `DATABASE_URL`.

   ```bash
   cp apps/api/.env.example apps/api/.env
   cp packages/database/.env.example packages/database/.env
   ```

2. Install everything:

   ```bash
   pnpm install
   ```

3. Create the tables:

   ```bash
   cd packages/database && npx prisma migrate deploy
   ```

4. Create the Owner account, the main store and the starting categories. Choose your own email and password:

   ```bash
   OWNER_EMAIL=you@example.com OWNER_PASSWORD='a-strong-password' npx tsx prisma/seed.ts
   ```

## Run it

```bash
pnpm dev
```

Then open **http://localhost:5175**.

| Part | Port |
|---|---|
| Website | 5175 |
| Server | 3001 |

These ports are deliberately not the usual 5173 and 3000, so AnteTech can run alongside other apps on the same computer. To change the server port, set `PORT` in `apps/api/.env`. If you do, start the website with `API_TARGET=http://localhost:<port>` so it can find the server.

## Checks

Both scripts need the server running. They create test stores, sellers and sales, so run them only against a development database.

```bash
cd apps/api
OWNER_EMAIL=... OWNER_PASSWORD=... pnpm smoke      # the main flows, end to end
OWNER_EMAIL=... OWNER_PASSWORD=... pnpm isolation  # a seller never sees another store's data
```
