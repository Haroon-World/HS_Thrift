const { query } = require('./_db');
const createVercelHandler = require('./_adapter');
const { sendContactFormEmail } = require('./_email');

const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch (e) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid JSON payload' })
      };
    }
  }

  const name = String(body.name || '').trim();
  const contact = String(body.contact || '').trim();
  const subject = String(body.subject || 'General Inquiry').trim();
  const message = String(body.message || '').trim();

  if (!name || !contact || !message) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Name, contact info, and message are required.' })
    };
  }

  try {
    // Ensure table exists
    await query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        contact VARCHAR(255) NOT NULL,
        subject VARCHAR(255),
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Insert into DB
    const res = await query(
      `INSERT INTO contact_messages (name, contact, subject, message, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, name, contact, subject, message, created_at`,
      [name, contact, subject, message]
    );

    const savedMsg = res.rows[0];

    // Send Admin Email Notification
    try {
      await sendContactFormEmail(savedMsg);
    } catch (emailErr) {
      console.error('[Contact API] Non-fatal email error:', emailErr.message);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Thank you! Your message has been sent to our studio.',
        id: savedMsg.id
      })
    };
  } catch (err) {
    console.error('[Contact API] Error saving contact message:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Internal Server Error while saving message.' })
    };
  }
};

module.exports = createVercelHandler(handler);
