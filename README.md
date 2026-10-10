# Arham Portfolio – deploy on Vercel + MongoDB

## 1. MongoDB Atlas
1. Atlas → your cluster → **Connect → Drivers → Node.js** → copy the connection string.
2. Replace `<password>` with your DB user's password (URL-encode special characters).
3. **Network Access** → allow `0.0.0.0/0` (Vercel uses dynamic IPs).

## 2. Seed the database (once)
```
npm install
cp .env.example .env     # put your MONGODB_URI in it
npm run seed
```

## 3. Deploy
```
npm i -g vercel
vercel          # first deploy
```
In **Project Settings → Environment Variables** add: `MONGODB_URI`, `MONGODB_DB`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD` (and optionally `GMAIL_USER`, `GMAIL_APP_PASSWORD`,
`NOTIFY_FROM_EMAIL`, `TIMEZONE`). Then `vercel --prod`.

## Local dev
```
npm start      # http://localhost:3000
```

## Structure
`server.js` is an Express app. Vercel runs it directly (it exports the app);
files in `public/` are served by Vercel's CDN. There is no `api/` folder or
`vercel.json` needed. Check `/api/health` after deploying to verify MongoDB.
