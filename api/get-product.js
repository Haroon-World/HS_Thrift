const { query } = require('./_db');
const createVercelHandler = require('./_adapter');

function sanitizeImage(img) {
  if (!img) return 'https://images.unsplash.com/photo-1551028719-00167b16eac5?q=80&w=600&auto=format&fit=crop';
  if (typeof img === 'string' && img.startsWith('data:image') && img.length > 250000) {
    return 'https://images.unsplash.com/photo-1551028719-00167b16eac5?q=80&w=600&auto=format&fit=crop';
  }
  return img;
}

const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const id = params.id;
    const slug = params.slug;

    if (!id && !slug) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Product ID or Slug is required.' })
      };
    }

    let sql = `
      SELECT 
        p.id, p.name, p.slug, p.tagline, p.description, 
        p.price, p.sale_price, p.image, p.image_url, p.stock_status, 
        p.crafted_time_hours, p.materials, p.dimensions, 
        p.condition_rating, p.size, p.is_featured, 
        p.is_best_seller, p.is_new_arrival, p.created_at,
        c.id as category_id, c.name as category_name, c.slug as category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE (p.is_archived = 0 OR p.is_archived = false OR p.is_archived IS NULL)
    `;

    const values = [];
    if (slug) {
      sql += ` AND p.slug = $1`;
      values.push(slug);
    } else {
      sql += ` AND p.id = $1`;
      values.push(id);
    }

    const result = await query(sql, values);

    if (result.rows.length === 0) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Product not found.' })
      };
    }

    const row = result.rows[0];
    const mainImg = sanitizeImage(row.image_url || row.image);
    const product = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      tagline: row.tagline,
      description: row.description,
      price: parseInt(row.price),
      sale_price: row.sale_price ? parseInt(row.sale_price) : null,
      effective_price: row.sale_price && parseInt(row.sale_price) < parseInt(row.price) ? parseInt(row.sale_price) : parseInt(row.price),
      is_on_sale: Boolean(row.sale_price && parseInt(row.sale_price) < parseInt(row.price)),
      image: mainImg,
      image_url: mainImg,
      stock_status: Boolean(row.stock_status),
      condition_rating: row.condition_rating || '9.5/10',
      size: row.size || 'M',
      materials: row.materials || '100% Curated Thrift',
      dimensions: row.dimensions || 'Standard Fit',
      is_featured: Boolean(row.is_featured),
      is_best_seller: Boolean(row.is_best_seller),
      is_new_arrival: Boolean(row.is_new_arrival),
      category: row.category_id ? {
        id: row.category_id,
        name: row.category_name,
        slug: row.category_slug
      } : null
    };

    let relatedProducts = [];
    if (row.category_id) {
      const relResult = await query(
        `SELECT id, name, slug, price, sale_price, image, image_url, stock_status, condition_rating, size 
         FROM products 
         WHERE category_id = $1 AND id != $2 AND (is_archived = 0 OR is_archived = false OR is_archived IS NULL) 
         LIMIT 4`,
        [row.category_id, row.id]
      );
      relatedProducts = relResult.rows.map(r => {
        const relImg = sanitizeImage(r.image_url || r.image);
        return {
          id: r.id,
          name: r.name,
          slug: r.slug,
          price: parseInt(r.price),
          effective_price: r.sale_price && parseInt(r.sale_price) < parseInt(r.price) ? parseInt(r.sale_price) : parseInt(r.price),
          image: relImg,
          image_url: relImg,
          condition_rating: r.condition_rating || '9.5/10',
          size: r.size || 'M',
          stock_status: Boolean(r.stock_status)
        };
      });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
      },
      body: JSON.stringify({ success: true, product, related: relatedProducts })
    };
  } catch (err) {
    console.error('Error fetching product detail:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Failed to retrieve product details.' })
    };
  }
};

module.exports = createVercelHandler(handler);
