const jwt = require('jsonwebtoken');

async function requireAdmin(event) {
  const authHeader = event.headers && (event.headers['authorization'] || event.headers['Authorization']);
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: true,
      response: {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Access denied. Token missing.' })
      }
    };
  }

  const token = authHeader.slice(7);
  const jwtSecret = process.env.ADMIN_JWT_SECRET;

  if (!jwtSecret) {
    return {
      error: true,
      response: {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Server configuration error.' })
      }
    };
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    return { error: false, adminId: decoded.adminId, email: decoded.email };
  } catch (err) {
    return {
      error: true,
      response: {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Session expired or invalid token. Please log in again.' })
      }
    };
  }
}

module.exports = { requireAdmin };
