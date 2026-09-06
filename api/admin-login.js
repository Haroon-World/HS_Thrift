const { query } = require('./_db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const createVercelHandler = require('./_adapter');

const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Invalid request format.' })
    };
  }

  const { email, password } = body;

  if (!email || !password) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Email and password are required.' })
    };
  }

  try {
    const result = await query(
      `SELECT id, email, password_hash FROM admin_users WHERE email = $1 LIMIT 1`,
      [email.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      await bcrypt.compare(password, '$2b$10$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid email or password.' })
      };
    }

    const admin = result.rows[0];
    const isValid = await bcrypt.compare(password, admin.password_hash);

    if (!isValid) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid email or password.' })
      };
    }

    const jwtSecret = process.env.ADMIN_JWT_SECRET;
    if (!jwtSecret) {
      console.error('ADMIN_JWT_SECRET environment variable is not set.');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Server configuration error.' })
      };
    }

    const token = jwt.sign(
      { adminId: admin.id, email: admin.email, role: 'admin' },
      jwtSecret,
      { expiresIn: '8h' }
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        token,
        email: admin.email
      })
    };
  } catch (err) {
    console.error('Admin login error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Login failed. Please try again.' })
    };
  }
};

module.exports = createVercelHandler(handler);
