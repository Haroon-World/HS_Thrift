require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { ensureSchema } = require('./api/_db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Request logging in development
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    if (!req.path.startsWith('/css') && !req.path.startsWith('/js') && !req.path.startsWith('/assets') && !req.path.includes('.')) {
      console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    }
    next();
  });
}

// Ensure database tables and initial data on startup
ensureSchema().then(() => {
  console.log('✅ HS_Thrift Database initialized successfully (SQLite local engine)');
}).catch(err => {
  console.error('❌ Database initialization error:', err);
});

// Mount API Endpoints (reusing the Vercel-compatible handlers)
const apiRoutes = [
  { path: '/api/get-products', handler: require('./api/get-products') },
  { path: '/api/get-product', handler: require('./api/get-product') },
  { path: '/api/create-order', handler: require('./api/create-order') },
  { path: '/api/admin-login', handler: require('./api/admin-login') },
  { path: '/api/admin-products', handler: require('./api/admin-products') },
  { path: '/api/admin-orders', handler: require('./api/admin-orders') },
  { path: '/api/admin-data', handler: require('./api/admin-data') },
  { path: '/api/admin-testimonials', handler: require('./api/admin-testimonials') },
  { path: '/api/get-testimonials', handler: require('./api/get-testimonials') },
  { path: '/api/contact', handler: require('./api/contact') },
  { path: '/api/newsletter-subscribe', handler: require('./api/newsletter-subscribe') },
  { path: '/api/images', handler: require('./api/images') }
];

apiRoutes.forEach(({ path: routePath, handler }) => {
  app.all(routePath, handler);
});

// Admin redirect helper
app.get('/admin', (req, res) => {
  res.redirect('/admin/dashboard.html');
});

// Serve static frontend from public folder with .html extension support
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html', 'htm']
}));

// Fallback for 404
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'API endpoint not found' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`
======================================================
  🔥 HS_Thrift — Curated Streetwear & Vintage Finds 🔥
======================================================
  🌐 Local Store URL:  http://localhost:${PORT}
  🛠️ Admin Panel:      http://localhost:${PORT}/admin/dashboard.html
  🔑 Admin Login:      admin@hsthrift.com / Admin@1234
  📦 Database:         Local SQLite (hs_thrift.db)
======================================================
`);
});
