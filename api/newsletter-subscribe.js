const { query } = require('./_db');
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

  const { email } = body;

  if (!email || !email.includes('@')) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Invalid email address.' })
    };
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await query(
      `SELECT id FROM newsletters WHERE email = $1`,
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, message: 'You are already subscribed to our newsletter.' })
      };
    }

    await query(
      `INSERT INTO newsletters (email) VALUES ($1)`,
      [normalizedEmail]
    );

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Thank you for subscribing to our artisan newsletter!' })
    };
  } catch (err) {
    console.error('Newsletter subscribe error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Subscription failed. Please try again.' })
    };
  }
};

module.exports = createVercelHandler(handler);
