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

    // Handle ?settings=true — return store settings & city rates for customer checkout
    if (params.settings === 'true' || params.settings === '1') {
      const result = await query(`SELECT customer_data_retention_days, standard_shipping_fee, free_shipping_threshold, online_payment_instructions, city_shipping_rates, promo_popup_enabled, promo_popup_title, promo_popup_desc FROM settings WHERE id = 1`);
      let settings = {
        standard_shipping_fee: 200,
        free_shipping_threshold: 3500,
        online_payment_instructions: 'Please transfer the payment via Easypaisa / JazzCash / Bank Transfer and send screenshot to our WhatsApp (+92 312 4894571) along with your Order ID.',
        city_shipping_rates: [
          { city: "Lahore", rate: 200 },
          { city: "Karachi", rate: 250 },
          { city: "Islamabad", rate: 220 },
          { city: "Rawalpindi", rate: 220 },
          { city: "Faisalabad", rate: 220 },
          { city: "Peshawar", rate: 250 },
          { city: "Quetta", rate: 250 },
          { city: "Multan", rate: 220 },
          { city: "Sialkot", rate: 220 },
          { city: "Gujranwala", rate: 220 }
        ],
        promo_popup_enabled: false,
        promo_popup_title: '🔥 Curated Streetwear Drops Weekly!',
        promo_popup_desc: 'Get authentic 90s vintage, windbreakers, and oversized tees at unbeatable prices. Single-piece thrift items—first come, first served!'
      };

      if (result.rows.length > 0) {
        const row = result.rows[0];
        if (row.standard_shipping_fee !== null && row.standard_shipping_fee !== undefined) settings.standard_shipping_fee = parseInt(row.standard_shipping_fee);
        if (row.free_shipping_threshold !== null && row.free_shipping_threshold !== undefined) settings.free_shipping_threshold = parseInt(row.free_shipping_threshold);
        if (row.online_payment_instructions) settings.online_payment_instructions = row.online_payment_instructions;
        if (row.promo_popup_enabled !== undefined && row.promo_popup_enabled !== null) {
          settings.promo_popup_enabled = Boolean(row.promo_popup_enabled);
        }
        if (row.promo_popup_title) settings.promo_popup_title = row.promo_popup_title;
        if (row.promo_popup_desc) settings.promo_popup_desc = row.promo_popup_desc;
        if (row.city_shipping_rates) {
          try {
            settings.city_shipping_rates = typeof row.city_shipping_rates === 'string' ? JSON.parse(row.city_shipping_rates) : row.city_shipping_rates;
          } catch (e) {}
        }
      }

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
        },
        body: JSON.stringify({ success: true, settings })
      };
    }

    // Handle ?categories=true — return all categories
    if (params.categories === 'true' || params.categories === '1') {
      const result = await query(`SELECT id, name, slug, description, image_url, created_at FROM categories ORDER BY id ASC`);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
        },
        body: JSON.stringify({ success: true, count: result.rows.length, categories: result.rows })
      };
    }

    const categorySlug = params.category ? params.category.trim() : null;
    const searchQ = params.q ? params.q.trim() : null;
    const inStockOnly = params.in_stock === '1' || params.in_stock === 'true';
    const under999 = params.under_999 === '1' || params.under_999 === 'true';
    const sizeFilter = params.size ? params.size.trim() : null;
    const conditionFilter = params.condition ? params.condition.trim() : null;
    const sort = params.sort || 'newest';

    try { await seedCatalogIfEmpty(); } catch(e) {
      console.error('Seed error:', e);
    }

    let sql = `
      SELECT 
        p.id, p.name, p.slug, p.tagline, p.description, p.short_description,
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
    let paramCount = 1;

    if (categorySlug) {
      sql += ` AND c.slug = $${paramCount}`;
      values.push(categorySlug);
      paramCount++;
    }

    if (searchQ) {
      sql += ` AND (p.name ILIKE $${paramCount} OR p.description ILIKE $${paramCount} OR p.materials ILIKE $${paramCount} OR p.tagline ILIKE $${paramCount})`;
      values.push(`%${searchQ}%`);
      paramCount++;
    }

    if (inStockOnly) {
      sql += ` AND (p.stock_status = 1 OR p.stock_status = true)`;
    }

    if (under999) {
      sql += ` AND (COALESCE(p.sale_price, p.price) <= 999)`;
    }

    if (sizeFilter) {
      sql += ` AND p.size ILIKE $${paramCount}`;
      values.push(`%${sizeFilter}%`);
      paramCount++;
    }

    if (conditionFilter) {
      sql += ` AND p.condition_rating ILIKE $${paramCount}`;
      values.push(`%${conditionFilter}%`);
      paramCount++;
    }

    if (sort === 'price_low') {
      sql += ` ORDER BY COALESCE(p.sale_price, p.price) ASC`;
    } else if (sort === 'price_high') {
      sql += ` ORDER BY COALESCE(p.sale_price, p.price) DESC`;
    } else if (sort === 'best_selling') {
      sql += ` ORDER BY p.is_best_seller DESC, p.created_at DESC`;
    } else {
      sql += ` ORDER BY p.created_at DESC`;
    }

    const result = await query(sql, values);

    const products = result.rows.map(row => {
      const img = sanitizeImage(row.image_url || row.image);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        tagline: row.tagline,
        description: row.description,
        short_description: row.short_description,
        price: parseInt(row.price),
        sale_price: row.sale_price ? parseInt(row.sale_price) : null,
        is_on_sale: Boolean(row.sale_price && parseInt(row.sale_price) > 0 && parseInt(row.sale_price) < parseInt(row.price)),
        image: img,
        image_url: img,
        stock_status: Boolean(row.stock_status),
        condition_rating: row.condition_rating || '9.5/10',
        size: row.size || 'M',
        materials: row.materials || '100% Curated Thrift',
        dimensions: row.dimensions || 'Standard Fit',
        is_featured: Boolean(row.is_featured),
        is_best_seller: Boolean(row.is_best_seller),
        is_new_arrival: Boolean(row.is_new_arrival),
        category: row.category_name ? {
          id: row.category_id,
          name: row.category_name,
          slug: row.category_slug
        } : null,
        created_at: row.created_at
      };
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
      },
      body: JSON.stringify({ success: true, count: products.length, products })
    };
  } catch (err) {
    console.error('Error fetching products:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Failed to fetch products from database.' })
    };
  }
};

async function seedCatalogIfEmpty() {
  const check = await query(`SELECT COUNT(*) as count FROM products`);
  const currentCount = parseInt(check.rows[0]?.count || 0);
  if (currentCount >= 10) return;

  const sampleProducts = [
    // Category 1: Vintage Jackets & Outerwear
    {
      cat: 1,
      name: "90s Retro Colorblock Windbreaker",
      slug: "90s-retro-colorblock-windbreaker",
      tagline: "Authentic Vintage Shell | Mint Condition",
      desc: "An iconic 90s retro windbreaker featuring vibrant teal, obsidian black, and neon piping. Ultra-lightweight water-resistant nylon shell, elastic cuffs, and breathable inner mesh lining. Cleaned, steam-sanitized, and ready to elevate your streetwear wardrobe.",
      sdesc: "Authentic 90s nylon windbreaker with retro colorblocking",
      price: 1850,
      sale: 1450,
      img: "https://images.unsplash.com/photo-1551028719-00167b16eac5?q=80&w=800&auto=format&fit=crop",
      cond: "10/10 Like New",
      size: "L (Oversized)",
      mat: "100% Ripstop Nylon",
      dim: "Chest: 46\", Length: 28\"",
      feat: true,
      best: true,
      newa: false
    },
    {
      cat: 1,
      name: "Vintage Distressed Denim Trucker Jacket",
      slug: "vintage-distressed-denim-trucker-jacket",
      tagline: "Heavyweight Denim | Natural Vintage Fade",
      desc: "Classic rugged denim jacket featuring authentic wash whiskers, heavy brass shank buttons, and double chest flap pockets. Perfect vintage boxy silhouette that pairs effortlessly with hoodies.",
      sdesc: "Heavyweight 14oz washed denim trucker jacket with brass hardware",
      price: 2200,
      sale: 1750,
      img: "https://images.unsplash.com/photo-1576995853123-5a10305d93c0?q=80&w=800&auto=format&fit=crop",
      cond: "9/10 Mint Vintage",
      size: "XL",
      mat: "100% Heavy Cotton Denim",
      dim: "Chest: 48\", Length: 27\"",
      feat: true,
      best: true,
      newa: false
    },
    {
      cat: 1,
      name: "Leather Aviator Bomber Jacket",
      slug: "vintage-leather-aviator-bomber-jacket",
      tagline: "Genuine Soft Leather | Ribbed Trim",
      desc: "Premium vintage leather bomber with supple broken-in texture, heavy-duty metal YKK zip, and quilted satin lining. An absolute thrift grail item at a small fraction of original cost.",
      sdesc: "Genuine distressed brown leather flight bomber jacket",
      price: 2950,
      sale: 2350,
      img: "https://images.unsplash.com/photo-1520975954732-35dd22299614?q=80&w=800&auto=format&fit=crop",
      cond: "9.5/10 Excellent",
      size: "L",
      mat: "Genuine Leather & Satin Lining",
      dim: "Chest: 44\", Length: 26\"",
      feat: true,
      best: false,
      newa: true
    },
    {
      cat: 1,
      name: "Vintage Plaid Flannel Overshirt",
      slug: "vintage-plaid-flannel-overshirt",
      tagline: "Heavy Brushed Cotton | Grunge Aesthetic",
      desc: "Thick, soft brushed cotton flannel in forest green and navy tartan plaid. Features dual chest pockets, tortoiseshell buttons, and an easy relaxed drape.",
      sdesc: "Heavyweight brushed cotton flannel in dark green tartan",
      price: 1350,
      sale: 950,
      img: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?q=80&w=800&auto=format&fit=crop",
      cond: "9/10 Gently Worn",
      size: "M",
      mat: "100% Brushed Cotton Flannel",
      dim: "Chest: 42\", Length: 29\"",
      feat: false,
      best: true,
      newa: false
    },

    // Category 2: Streetwear Hoodies & Sweaters
    {
      cat: 2,
      name: "Heavyweight Washed Vintage Hoodie",
      slug: "heavyweight-washed-vintage-hoodie",
      tagline: "450 GSM French Terry | Boxy Fit",
      desc: "Ultra-comfortable 450 GSM washed charcoal hoodie with drop shoulders, seamless double-layered hood, and kangaroo pocket. Features that coveted sun-faded streetwear patina.",
      sdesc: "Faded charcoal heavyweight 450 GSM French terry hoodie",
      price: 1650,
      sale: 1250,
      img: "https://images.unsplash.com/photo-1556905055-8f358a7a47b2?q=80&w=800&auto=format&fit=crop",
      cond: "10/10 Pristine",
      size: "L (Boxy Drop Shoulder)",
      mat: "100% French Terry Cotton",
      dim: "Chest: 46\", Length: 27\"",
      feat: true,
      best: true,
      newa: false
    },
    {
      cat: 2,
      name: "Retro Collegiate Athletic Crewneck",
      slug: "retro-collegiate-athletic-crewneck",
      tagline: "Arch Embroidery | Ribbed Side Panels",
      desc: "Authentic varsity fleece sweatshirt featuring raised tackle-twill chest lettering, ribbed neckband, and cross-grain fleece construction that prevents vertical shrinking.",
      sdesc: "Vintage maroon collegiate arch sweatshirt with ribbed trim",
      price: 1450,
      sale: 1100,
      img: "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?q=80&w=800&auto=format&fit=crop",
      cond: "9.5/10 Mint",
      size: "XL",
      mat: "Cotton Fleece Blend",
      dim: "Chest: 48\", Length: 28\"",
      feat: false,
      best: true,
      newa: false
    },
    {
      cat: 2,
      name: "90s Nordic Pattern Wool-Blend Sweater",
      slug: "90s-nordic-pattern-wool-blend-sweater",
      tagline: "Chunky Cable Knit | Warm Earth Tones",
      desc: "Cozy vintage knit sweater with intricate Scandinavian geometric patterns across the chest and shoulders. Warm, non-scratchy wool-cotton blend.",
      sdesc: "Hand-knit aesthetic Nordic geometric pattern sweater",
      price: 1750,
      sale: 1350,
      img: "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?q=80&w=800&auto=format&fit=crop",
      cond: "9/10 Gently Used",
      size: "M",
      mat: "Wool & Cotton Blend",
      dim: "Chest: 42\", Length: 27\"",
      feat: true,
      best: false,
      newa: true
    },

    // Category 3: Graphic & Vintage Tees
    {
      cat: 3,
      name: "Vintage Grunge Rock Graphic Tee",
      slug: "vintage-grunge-rock-graphic-tee",
      tagline: "Single Stitch | Faded Washed Black",
      desc: "Authentic grunge concert aesthetic tee with cracked retro screen print, distressed ribbed crew collar, and soft single-stitch hem. Unmatched vintage drape.",
      sdesc: "Single-stitch faded black graphic band tee with vintage wash",
      price: 850,
      sale: 650,
      img: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?q=80&w=800&auto=format&fit=crop",
      cond: "9/10 Vintage Patina",
      size: "L",
      mat: "100% Pre-Shrunk Combed Cotton",
      dim: "Chest: 44\", Length: 29\"",
      feat: true,
      best: true,
      newa: false
    },
    {
      cat: 3,
      name: "Oversized Tokyo Streetwear Anime Tee",
      slug: "oversized-tokyo-streetwear-anime-tee",
      tagline: "Bold Back Print | Drop Shoulder Fit",
      desc: "Heavy 240 GSM organic cotton t-shirt with cyberpunk Tokyo typography on front and full-back graphic print. Super clean streetwear piece.",
      sdesc: "Heavyweight boxy tee with Tokyo streetwear back graphic",
      price: 890,
      sale: 690,
      img: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?q=80&w=800&auto=format&fit=crop",
      cond: "10/10 Like New",
      size: "XL (Boxy Fit)",
      mat: "240 GSM Ring-Spun Cotton",
      dim: "Chest: 46\", Length: 30\"",
      feat: false,
      best: true,
      newa: true
    },
    {
      cat: 3,
      name: "Retro Motorsport Racing Tee",
      slug: "retro-motorsport-racing-tee",
      tagline: "90s Formula Racing Badges & Patches",
      desc: "Vibrant yellow and black vintage racing tee with sponsor graphics, checkered accents, and contrast ribbed collar. Clean thrift find.",
      sdesc: "Vintage motorsport graphic t-shirt with retro sponsor prints",
      price: 750,
      sale: 550,
      img: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=800&auto=format&fit=crop",
      cond: "9.5/10 Mint",
      size: "M",
      mat: "100% Cotton Jersey",
      dim: "Chest: 40\", Length: 28\"",
      feat: false,
      best: false,
      newa: true
    },
    {
      cat: 3,
      name: "Minimalist Washed Sage Pocket Tee",
      slug: "minimalist-washed-sage-pocket-tee",
      tagline: "Garment Dyed | Chest Patch Pocket",
      desc: "Understated garment-dyed pocket tee in a muted sage green tone. Ultra-soft worn-in texture with reinforced seam construction.",
      sdesc: "Soft garment-dyed sage green pocket t-shirt",
      price: 590,
      sale: 450,
      img: "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?q=80&w=800&auto=format&fit=crop",
      cond: "10/10 Pristine",
      size: "S / M",
      mat: "100% Organic Cotton",
      dim: "Chest: 38\", Length: 27\"",
      feat: false,
      best: true,
      newa: false
    },

    // Category 4: Cargo Pants & Vintage Denim
    {
      cat: 4,
      name: "90s Skater Baggy Carpenter Jeans",
      slug: "90s-skater-baggy-carpenter-jeans",
      tagline: "Utility Hammer Loop | Wide Leg Silhouette",
      desc: "Authentic 90s baggy carpenter denim featuring wide leg cut, utility side pockets, hammer loop, and durable triple-stitched seams. Authentic vintage mid-blue fade.",
      sdesc: "Wide-leg carpenter jeans with utility pockets in light wash",
      price: 1650,
      sale: 1350,
      img: "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?q=80&w=800&auto=format&fit=crop",
      cond: "9.5/10 Mint",
      size: "Waist 32\" (Loose Fit)",
      mat: "100% Cotton Denim",
      dim: "Waist: 32\", Inseam: 31\", Leg Opening: 9\"",
      feat: true,
      best: true,
      newa: false
    },
    {
      cat: 4,
      name: "Tactical Multi-Pocket Cargo Trousers",
      slug: "tactical-multi-pocket-cargo-trousers",
      tagline: "Olive Drab Cotton Twill | 6 Utility Pockets",
      desc: "Military-inspired heavy cotton twill cargo pants with dual bellow cargo pockets, drawstring ankle hems, and reinforced knee articulation.",
      sdesc: "Military olive drab 6-pocket cargo pants with ankle ties",
      price: 1550,
      sale: 1200,
      img: "https://images.unsplash.com/photo-1517445312882-bc9910d016b7?q=80&w=800&auto=format&fit=crop",
      cond: "10/10 Like New",
      size: "Waist 34\"",
      mat: "Heavyweight Cotton Twill",
      dim: "Waist: 34\", Inseam: 32\"",
      feat: false,
      best: true,
      newa: false
    },
    {
      cat: 4,
      name: "Vintage Washed Corduroy Straight Pants",
      slug: "vintage-washed-corduroy-straight-pants",
      tagline: "Rich Chocolate Brown | Fine Wale Corduroy",
      desc: "Vintage 8-wale corduroy trousers in warm mocha brown. Straight leg fit with classic 5-pocket denim styling and vintage brass rivets.",
      sdesc: "Straight-fit brown corduroy trousers with brass rivets",
      price: 1400,
      sale: 1100,
      img: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?q=80&w=800&auto=format&fit=crop",
      cond: "9/10 Gently Used",
      size: "Waist 30\"",
      mat: "100% Cotton Corduroy",
      dim: "Waist: 30\", Inseam: 30\"",
      feat: false,
      best: false,
      newa: true
    },

    // Category 5: Caps, Bags & Retro Accessories
    {
      cat: 5,
      name: "Vintage Washed Corduroy Dad Cap",
      slug: "vintage-washed-corduroy-dad-cap",
      tagline: "Unstructured 6-Panel | Antique Brass Clasp",
      desc: "Relaxed unstructured corduroy cap in washed forest green. Curved brim, embroidered eyelets, and adjustable brass slider strap at rear.",
      sdesc: "Forest green corduroy dad hat with adjustable brass strap",
      price: 490,
      sale: 390,
      img: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?q=80&w=800&auto=format&fit=crop",
      cond: "10/10 New With Tags",
      size: "One Size (Adjustable)",
      mat: "100% Cotton Corduroy",
      dim: "Circumference: 54-60cm",
      feat: true,
      best: true,
      newa: false
    },
    {
      cat: 5,
      name: "Y2K Crossbody Tactical Sling Bag",
      slug: "y2k-crossbody-tactical-sling-bag",
      tagline: "Cordura Nylon | Multi-Compartment Utility",
      desc: "Compact streetwear messenger sling bag with weather-resistant zippers, internal mesh organizer, and quick-release buckle shoulder strap.",
      sdesc: "Black tactical crossbody sling bag with quick-release buckle",
      price: 890,
      sale: 690,
      img: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?q=80&w=800&auto=format&fit=crop",
      cond: "9.5/10 Mint",
      size: "One Size (9\" x 6\" x 2.5\")",
      mat: "High-Density Cordura Nylon",
      dim: "9\" H x 6\" W x 2.5\" D",
      feat: true,
      best: false,
      newa: true
    },
    {
      cat: 5,
      name: "Authentic Vintage Leather Brass Buckle Belt",
      slug: "authentic-vintage-leather-brass-buckle-belt",
      tagline: "Solid Full-Grain Leather | Heavy Antique Buckle",
      desc: "Rugged 1.5-inch wide dark cognac leather belt featuring double edge stitching and a solid antiqued brass roller buckle. Built to last a lifetime.",
      sdesc: "Full-grain cognac leather belt with antique brass buckle",
      price: 550,
      sale: 450,
      img: "https://images.unsplash.com/photo-1624222247344-550fb60583dc?q=80&w=800&auto=format&fit=crop",
      cond: "9/10 Vintage Patina",
      size: "Fits Waist 30-36\"",
      mat: "100% Full-Grain Leather",
      dim: "Width: 1.5\", Total Length: 42\"",
      feat: false,
      best: true,
      newa: false
    },
    {
      cat: 5,
      name: "Retro Chunky Knit Fisherman Beanie",
      slug: "retro-chunky-knit-fisherman-beanie",
      tagline: "Ribbed Cuff | Mustard Yellow & Charcoal",
      desc: "Classic shallow-fit fisherman beanie in ribbed knit. Elastic stretch provides snug, itch-free comfort in all weather.",
      sdesc: "Chunky ribbed fisherman beanie in warm vintage mustard",
      price: 450,
      sale: 350,
      img: "https://images.unsplash.com/photo-1576871337622-98d48d1cf531?q=80&w=800&auto=format&fit=crop",
      cond: "10/10 Pristine",
      size: "One Size Fits All",
      mat: "Soft Acrylic & Wool Blend",
      dim: "Stretch to Fit",
      feat: false,
      best: false,
      newa: true
    }
  ];

  for (const p of sampleProducts) {
    try {
      const exists = await query(`SELECT id FROM products WHERE slug = $1`, [p.slug]);
      if (exists.rows.length === 0) {
        await query(
          `INSERT INTO products (
            category_id, name, slug, tagline, description, short_description, 
            price, sale_price, image, image_url, stock_status, 
            condition_rating, size, materials, dimensions,
            is_featured, is_best_seller, is_new_arrival
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $12, $13, $14, $15, $16, $17)`,
          [
            p.cat, p.name, p.slug, p.tagline, p.desc, p.sdesc,
            p.price, p.sale, p.img, p.img,
            p.cond, p.size, p.mat, p.dim,
            p.feat ? 1 : 0, p.best ? 1 : 0, p.newa ? 1 : 0
          ]
        );
      }
    } catch(e) {
      console.error('Seed product error for', p.name, ':', e.message);
    }
  }
  console.log('✅ HS_Thrift initial catalog seeded successfully');
}

module.exports = createVercelHandler(handler);
