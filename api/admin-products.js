const { query } = require('./_db');
const { requireAdmin } = require('./_admin-auth');
const createVercelHandler = require('./_adapter');

const NOCACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0'
};

const handler = async (event) => {
  const auth = await requireAdmin(event);
  if (auth.error) return auth.response;

  const method = event.httpMethod;
  const params = event.queryStringParameters || {};

  try {
    if (method === 'GET') {
      const result = await query(`
        SELECT p.id, p.slug, p.name, p.tagline, p.description, p.short_description,
               p.price, p.sale_price, p.image, p.image_url, p.stock_status,
               p.is_archived, p.is_featured, p.is_best_seller, p.is_new_arrival,
               p.condition_rating, p.size, p.dimensions,
               p.crafted_time_hours, p.materials, p.category_id, p.created_at, c.name as category_name
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        ORDER BY p.is_archived ASC, p.created_at DESC
      `);

      const products = result.rows.map(r => ({
        ...r,
        image_url: r.image_url || r.image || '',
        is_on_sale: Boolean(r.sale_price && r.sale_price > 0 && r.sale_price < r.price)
      }));

      return {
        statusCode: 200,
        headers: NOCACHE_HEADERS,
        body: JSON.stringify({ success: true, products })
      };
    }

    if (method === 'POST') {
      let body;
      try { body = JSON.parse(event.body); }
      catch (e) { return badRequest('Invalid request format.'); }

      const {
        name, slug, tagline, description, short_description, price, sale_price,
        category_id, stock_status, image_url, image, is_featured, is_best_seller,
        is_new_arrival, condition_rating, size, materials, dimensions
      } = body;

      if (!name || price === undefined || price === null || isNaN(parseInt(price))) {
        return badRequest('Product name and valid price are required.');
      }

      const finalImg = image_url || image || 'https://images.unsplash.com/photo-1551028719-00167b16eac5?q=80&w=600&auto=format&fit=crop';
      const cleanName = String(name).trim();
      const baseSlug = (slug || cleanName).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const uniqueSlug = baseSlug + '-' + Math.floor(Math.random() * 899 + 100);
      const catId = category_id && !isNaN(parseInt(category_id)) ? parseInt(category_id) : 1;
      const numPrice = parseInt(price) || 0;
      const numSale = sale_price && parseInt(sale_price) > 0 ? parseInt(sale_price) : null;
      const condRating = condition_rating || '9.5/10';
      const sizeVal = size || 'M';
      const matStr = materials ? String(materials).trim() : '100% Curated Thrift';
      const dimStr = dimensions ? String(dimensions).trim() : 'Standard Fit';

      const insertValues = [
        cleanName,
        uniqueSlug,
        tagline || 'Curated Thrift Piece',
        description || '',
        short_description || '',
        numPrice,
        numSale,
        catId,
        stock_status !== false ? 1 : 0,
        finalImg,
        finalImg,
        condRating,
        sizeVal,
        matStr,
        dimStr,
        Boolean(is_featured) ? 1 : 0,
        Boolean(is_best_seller) ? 1 : 0,
        Boolean(is_new_arrival) ? 1 : 0
      ];

      const insertSQL = `
        INSERT INTO products (
          name, slug, tagline, description, short_description, price, sale_price,
          category_id, stock_status, image, image_url, condition_rating, size,
          materials, dimensions, is_featured, is_best_seller, is_new_arrival
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING id, name, slug, price, sale_price, category_id, stock_status, condition_rating, size, is_featured, is_best_seller, is_new_arrival, image, image_url
      `;

      let result = await query(insertSQL, insertValues);

      return {
        statusCode: 201,
        headers: NOCACHE_HEADERS,
        body: JSON.stringify({ success: true, product: result.rows[0] })
      };
    }

    if (method === 'PATCH') {
      let body;
      try { body = JSON.parse(event.body); }
      catch (e) { return badRequest('Invalid request format.'); }

      const productId = params.id;
      if (!productId) return badRequest('Product ID is required in query string ?id=...');

      const allowed = [
        'name', 'slug', 'tagline', 'description', 'short_description', 'price',
        'sale_price', 'category_id', 'stock_status', 'image', 'image_url',
        'is_archived', 'is_featured', 'is_best_seller', 'is_new_arrival',
        'condition_rating', 'size', 'materials', 'dimensions'
      ];

      const setClauses = [];
      const values = [];
      let paramCount = 1;

      for (const field of allowed) {
        if (body[field] !== undefined) {
          setClauses.push(`${field} = $${paramCount}`);
          if (['stock_status', 'is_archived', 'is_featured', 'is_best_seller', 'is_new_arrival'].includes(field)) {
            values.push(body[field] ? 1 : 0);
          } else if (['price', 'sale_price', 'category_id'].includes(field)) {
            values.push(body[field] !== null ? parseInt(body[field]) : null);
          } else {
            values.push(body[field]);
          }
          paramCount++;
        }
      }

      if (setClauses.length === 0) {
        return badRequest('No valid fields provided for update.');
      }

      values.push(productId);
      const updateSQL = `
        UPDATE products
        SET ${setClauses.join(', ')}
        WHERE id = $${paramCount}
        RETURNING id, name, slug, price, sale_price, category_id, stock_status, condition_rating, size, is_archived, is_featured, is_best_seller, is_new_arrival
      `;

      const result = await query(updateSQL, values);
      if (result.rows.length === 0) {
        return {
          statusCode: 404,
          headers: NOCACHE_HEADERS,
          body: JSON.stringify({ success: false, error: 'Product not found.' })
        };
      }

      return {
        statusCode: 200,
        headers: NOCACHE_HEADERS,
        body: JSON.stringify({ success: true, product: result.rows[0] })
      };
    }

    if (method === 'DELETE') {
      const productId = params.id;
      if (!productId) return badRequest('Product ID is required for deletion.');

      // Soft delete by archiving
      await query(`UPDATE products SET is_archived = 1, stock_status = 0 WHERE id = $1`, [productId]);

      return {
        statusCode: 200,
        headers: NOCACHE_HEADERS,
        body: JSON.stringify({ success: true, message: 'Product archived successfully.' })
      };
    }

    return {
      statusCode: 405,
      headers: NOCACHE_HEADERS,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };

  } catch (err) {
    console.error('Admin products API error:', err);
    return {
      statusCode: 500,
      headers: NOCACHE_HEADERS,
      body: JSON.stringify({ success: false, error: err.message || 'Internal server error.' })
    };
  }
};

function badRequest(msg) {
  return {
    statusCode: 400,
    headers: NOCACHE_HEADERS,
    body: JSON.stringify({ success: false, error: msg })
  };
}

module.exports = createVercelHandler(handler);
