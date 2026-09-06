# HS_Thrift

**Pakistan's Premier Curated Streetwear & Vintage Thrift Store**

> Hand-picked. Condition-graded. Steam-sanitized. Unbeatable prices.

---

## 🚀 Quick Start (Local)

1. Make sure **Node.js v18+** is installed
2. Double-click **`start.bat`** — that's it!
3. Browser opens automatically at `http://localhost:3000`

Or manually:
```bash
npm install
node server.js
```

| URL | Description |
|-----|-------------|
| `http://localhost:3000` | Customer-facing store |
| `http://localhost:3000/admin/dashboard.html` | Admin Panel |

**Admin Credentials:** `admin@hsthrift.com` / `Admin@1234`

---

## 🗄️ Database

- **Local (Default):** Zero-config SQLite (`hs_thrift.db`) — auto-created on first run
- **Production (Future):** Set `DATABASE_URL=postgresql://...` in `.env` to switch to Neon PostgreSQL with zero code changes

---

## 📁 Project Structure

```
HS_Thrift/
├── server.js          # Local Express server
├── start.bat          # Windows quick launch
├── .env               # Environment config
├── api/               # API handlers (Vercel-compatible)
│   ├── _db.js         # Dual SQLite/PostgreSQL engine
│   ├── get-products.js
│   ├── create-order.js
│   ├── admin-*.js
│   └── ...
├── public/            # Frontend (HTML/CSS/JS)
│   ├── index.html     # Homepage
│   ├── shop.html      # Shop with filters
│   ├── product.html   # Product detail
│   ├── cart.html      # Cart
│   ├── checkout.html  # Checkout
│   ├── admin/         # Admin panel
│   ├── css/           # Styles
│   └── js/app.js      # Client-side JS
```

---

## 🎨 Design System

| Token | Color | Use |
|-------|-------|-----|
| Obsidian Slate | `#0F172A` | Primary background, buttons |
| Emerald Green | `#10B981` | Accent, badges, CTAs |
| Amber Gold | `#F59E0B` | Sale badges, highlights |
| Ice White | `#F8FAFC` | Background |

**Fonts:** Outfit (headings), Plus Jakarta Sans (body), Space Grotesk (display)

---

## 🔧 Future Deployment (Neon + Vercel)

1. Create Neon PostgreSQL database
2. Set `DATABASE_URL` in `.env` or Vercel environment
3. Push to GitHub and connect to Vercel — done!

---

© 2026 HS_Thrift. Curated · Graded · Sustainable.
