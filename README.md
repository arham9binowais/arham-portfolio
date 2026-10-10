# Arham Bin Owais – Portfolio CMS

A personal portfolio website with a built-in **visual editor**, a **MongoDB-backed content store**, and **email alerts** whenever someone visits or edits the site. Everything on the page (hero, about, skills, projects, and more) is stored in the database and can be changed live from the editor, with no code changes or redeploys.

> **Live demo:** _(https://arham-portfolio-omega.vercel.app/)_


<img width="1920" height="939" alt="image" src="https://github.com/user-attachments/assets/5d6bdcba-0a9c-4f28-a426-7720816f735c" />
<img width="1917" height="932" alt="image" src="https://github.com/user-attachments/assets/a4386934-29e7-4f58-bce5-f353be10cee0" />
<img width="1920" height="939" alt="image" src="https://github.com/user-attachments/assets/84cccd46-33c5-4ee1-9b57-1c3dd9a813fc" />



---

## Features

### Public portfolio
- Animated landing flow: visitors enter their name, then open the portfolio
- Animated background (particle canvas, shooting stars) and a typing effect in the hero
- Scroll-reveal animations, floating navigation, and a responsive hamburger menu
- Sections: **Hero, About, Skills, Education, Certifications, Projects, Contact, Footer**, plus any custom sections you add
- Contact links for email, phone, and GitHub
- Fully responsive layout

### Admin editor
- Password-protected editor (`/editor`) with a sidebar for every section
- **Drag-and-drop** reordering of sections, list items, and elements
- **Custom sections** built from blocks: heading, text, button, download, input, link, list, image, divider, spacer, and nested boxes
- **Autosave** two seconds after you stop typing, plus `Ctrl + S`
- Raw **JSON editor** for bulk changes
- Live "who's online" view for the admin

### Notifications and sessions
- Email alert when someone **opens** the portfolio
- Email alert when the admin **logs in** to the editor
- **Batched edit summaries**: one email listing exactly what changed (old → new), sent about 5 minutes after the first edit, or immediately on logout
- Email when someone **leaves**, including how long they stayed
- Browsers send a heartbeat; sessions that go silent for 15–30 minutes are treated as offline automatically
- Every session is stored in MongoDB, so it works on serverless hosting

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, vanilla JavaScript, Font Awesome icons |
| Backend | Node.js 24, Express |
| Database | MongoDB Atlas (official `mongodb` driver) |
| Email | Nodemailer with Gmail SMTP (App Password) |
| Hosting | Vercel (static files from the CDN plus the Express app as a serverless function) |

---

## Project structure

```
arham-portfolio/
├── public/
│   ├── landing.html      # Name entry / admin login
│   ├── portfolio.html    # The public portfolio
│   ├── editor.html       # Admin editor
│   ├── main.js           # Portfolio rendering and animations
│   ├── editor.js         # Editor logic (autosave, drag and drop)
│   ├── style.css
│   └── editor.css
├── server.js             # Express app: API, sessions, email alerts
├── seed.js               # One-time script to create the initial portfolio in MongoDB
├── package.json
├── .env.example          # Environment variable template
└── README.md
```

---

## API overview

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/visitor` | Public | Start a visitor session |
| POST | `/api/auth/admin` | Public | Admin login (email and password) |
| GET | `/api/auth/validate` | Token | Check a session |
| POST | `/api/auth/logout` | Token | End a session |
| POST | `/api/heartbeat` | Token | Keep a session alive |
| GET | `/api/online` | Admin | List current sessions |
| GET | `/api/portfolio` | Public | Read the portfolio data |
| PUT | `/api/portfolio` | Admin | Replace all portfolio data |
| PUT | `/api/portfolio/:section` | Admin | Update a single section |
| GET | `/api/health` | Public | Setup check (shows which settings exist and whether MongoDB connects) |

---

## Getting started

### Prerequisites
- Node.js 24 or newer
- A free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster
- (Optional) A Gmail account with an [App Password](https://myaccount.google.com/apppasswords) for email alerts

### 1. Install
```bash
git clone https://github.com/<your-username>/arham-portfolio.git
cd arham-portfolio
npm install
```

### 2. Configure
```bash
cp .env.example .env
```
Fill in `.env`:

| Variable | Description |
|---|---|
| `MONGODB_URI` | Atlas connection string (Connect → Drivers → Node.js) |
| `MONGODB_DB` | Database name, for example `portfolio` |
| `MONGODB_COLLECTION` | Portfolio collection, default `portfolios` |
| `MONGODB_SESSIONS_COLLECTION` | Session collection, default `sessiondb` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Credentials for the editor |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Gmail SMTP login for alerts |
| `NOTIFY_FROM_EMAIL` / `NOTIFY_TO_EMAIL` | Sender and recipient of alerts |
| `TIMEZONE` | For example `Asia/Karachi` |
| `OFFLINE_MIN_MINUTES` / `OFFLINE_MAX_MINUTES` | Idle time before a session counts as offline (default 15–30) |
| `PENDING_EDIT_DELAY_MS` | Delay before an edit summary email (default 300000) |
| `MONGODB_DNS_SERVERS` | Optional, for local networks that block SRV lookups, e.g. `1.1.1.1,8.8.8.8` |

> Never commit `.env`. It is already in `.gitignore`.

In Atlas, allow your IP (and `0.0.0.0/0` for Vercel) under **Network Access**.

### 3. Seed the database (once)
```bash
npm run seed
```

### 4. Run locally
```bash
npm start
# http://localhost:3000
```

---

## Deploy on Vercel

1. Push the project to GitHub and import it in Vercel (or run `vercel --prod`).
2. Under **Settings → Environment Variables**, add the variables above for **Production** and **Preview**. Do not set `PORT` or `MONGODB_DNS_SERVERS`.
3. Deploy, then open `/api/health` to confirm `mongo: connected`.

Vercel serves everything in `public/` from its CDN and runs `server.js` (the Express app) for the `/api` routes.

> On Vercel there are no background timers. The offline sweep and edit-summary emails run when the next request arrives, or immediately at logout.

---

## Security notes
- Admin login is disabled on Vercel until `ADMIN_PASSWORD` is set.
- Keep secrets in environment variables only. If one is ever exposed, rotate it.
- `/api/health` only reports whether settings exist, never their values. Remove it if you don't need it.

---

## Author

**Arham Bin Owais**
