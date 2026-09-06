const { query } = require('./_db');
const { requireAdmin } = require('./_admin-auth');
const createVercelHandler = require('./_adapter');

const handler = async (event) => {
  const auth = await requireAdmin(event);
  if (auth.error) return auth.response;

  const method = event.httpMethod;
  const params = event.queryStringParameters || {};

  try {
    if (method === 'GET') {
      const result = await query(`
        SELECT id, author_name as author, content as body, created_at
        FROM testimonials
        ORDER BY created_at DESC
      `);
      return ok({ testimonials: result.rows });
    }

    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const authorVal = body.author_name || body.author;
      const contentVal = body.content || body.testimonialBody || body.body;
      if (!authorVal || !contentVal) return badRequest('Author name and testimonial text are required.');

      const result = await query(
        `INSERT INTO testimonials (author_name, content) VALUES ($1, $2) RETURNING id, author_name as author, content as body, created_at`,
        [authorVal.trim(), contentVal.trim()]
      );
      return { statusCode: 201, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, testimonial: result.rows[0] }) };
    }

    if (method === 'DELETE') {
      const id = params.id;
      if (!id) return badRequest('Testimonial ID is required.');
      await query(`DELETE FROM testimonials WHERE id = $1`, [id]);
      return ok({ message: 'Testimonial deleted successfully.' });
    }

    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  } catch (err) {
    console.error('Admin testimonials error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Failed to manage testimonials.' }) };
  }
};

function ok(data) { return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, ...data }) }; }
function badRequest(msg) { return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: msg }) }; }

module.exports = createVercelHandler(handler);
