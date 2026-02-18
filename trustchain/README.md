# TrustChain

TrustChain is a full-stack Web3 application for decentralized proof-of-authenticity and ownership on **Algorand TestNet**.

Users can:
- Upload a digital file
- Generate a SHA256 hash
- Store that hash in an Algorand transaction note
- Mint an Algorand Standard Asset (ASA) as a one-of-one proof NFT
- Verify file authenticity against a public transaction ID

## Project Structure

```text
trustchain/
  frontend/
    index.html
    issue.html
    verify.html
    dashboard.html
    style.css
    script.js

  backend/
    server.js
    algorand.js
    routes.js
    package.json
    .env.example

  README.md
```

## Core Features

- Landing page with CTA flow
- Proof issuance flow (file upload -> hash -> on-chain transaction -> ASA mint)
- Public verification portal (`VERIFIED` / `INVALID`)
- Dashboard with issued proof records and transaction history
- Dashboard data sourced from Algorand Indexer (stateless backend)
- API endpoint configuration modal for local and production environments

## Prerequisites

- Node.js 18+
- npm
- Funded Algorand TestNet account mnemonic
  - Create/fund via Algorand TestNet dispenser

## Local Setup

### 1. Backend

```bash
cd trustchain/backend
npm install
cp .env.example .env
```

Update `.env` values:

- `ALGORAND_MNEMONIC`: issuer wallet mnemonic (required)
- `ALGOD_SERVER`, `INDEXER_SERVER`: defaults already set to AlgoNode TestNet endpoints
- `ALLOWED_ORIGIN`: frontend origin (for local use `http://localhost:3000`)

Start backend:

```bash
node server.js
```

Backend health check:

```bash
http://localhost:4000/api/health
```

Fund the issuer wallet before issuing proofs:
- Check wallet and balance at `GET /api/issuer/status`
- Use the returned address and fund it via `https://lora.algokit.io/testnet/fund`

### 2. Frontend

Run any static server from `trustchain` root:

```bash
npx serve frontend -l 3000
```

Open:

```text
http://localhost:3000
```

By default, frontend points to `http://localhost:4000/api` on localhost.

## API Endpoints

- `GET /api/health`
- `GET /api/issuer`
- `GET /api/issuer/status`
- `POST /api/proofs/issue` (multipart form, field: `file`)
- `POST /api/proofs/verify` (multipart form, fields: `file`, `transactionId`)
- `GET /api/proofs`
- `GET /api/transactions/history`

## Security Notes

- Private key material is never hardcoded
- Mnemonic is loaded from environment variables only
- Upload size limit enforced (`MAX_FILE_SIZE_MB`)
- Input validation for file uploads and transaction ID format
- Centralized async error handling in Express

## Deployment

## 1. GitHub

```bash
cd trustchain
git init
git add .
git commit -m "Initial TrustChain release"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## 2. Backend on Render

1. Create a new **Web Service** in Render from your GitHub repo.
2. Set Root Directory to: `trustchain/backend`
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Add environment variables from `.env.example`.
6. Set `ALLOWED_ORIGIN` to your Vercel frontend domain (for example `https://your-app.vercel.app`).

After deploy, note your backend URL (for example `https://your-backend.onrender.com`).

## 3. Frontend on Vercel

1. Import the GitHub repo in Vercel.
2. Set Root Directory to the repository root (default).
3. Framework preset: `Other`
4. Build command: none
5. Output directory: `.`
6. Add Vercel environment variables from `trustchain/backend/.env.example`:
   - `ALGOD_SERVER`, `ALGOD_TOKEN`, `ALGOD_PORT`
   - `INDEXER_SERVER`, `INDEXER_TOKEN`, `INDEXER_PORT`
   - `ALGORAND_MNEMONIC`
   - `ALLOWED_ORIGIN=*`, `MAX_FILE_SIZE_MB`, `ISSUE_MIN_RECOMMENDED_MICROALGOS`

This repo includes:
- root `vercel.json` routes for frontend pages
- root `api/[...path].js` serverless function that serves TrustChain backend API on `/api/*`

So frontend and backend run together on one Vercel project.

## Production Checklist

- Use a dedicated TestNet issuer account and keep mnemonic secure
- Keep `ALLOWED_ORIGIN` locked to trusted domains
- Monitor backend logs and rate-limit if exposing publicly

## License

MIT
