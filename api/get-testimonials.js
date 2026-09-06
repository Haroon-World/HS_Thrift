const { query } = require('./_db');
const createVercelHandler = require('./_adapter');

const NOCACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0'
};

const handler = async (event) => {
  try {
    const result = await query(`
      SELECT id, author_name as author, content as body, created_at
      FROM testimonials
      ORDER BY created_at DESC
    `);
    return {
      statusCode: 200,
      headers: NOCACHE_HEADERS,
      body: JSON.stringify({ success: true, testimonials: result.rows })
    };
  } catch (err) {
    console.error('get-testimonials API error:', err);
    return {
      statusCode: 500,
      headers: NOCACHE_HEADERS,
      body: JSON.stringify({ success: false, error: 'Failed to fetch testimonials.' })
    };
  }
};

module.exports = createVercelHandler(handler);
