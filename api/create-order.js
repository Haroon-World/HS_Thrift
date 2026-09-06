const { query, getPool } = require('./_db');
const crypto = require('crypto');
const createVercelHandler = require('./_adapter');
const { sendAdminOrderNotificationEmail } = require('./_email');

/**
 * Validates and normalizes phone number to E.164 international format (+<country_code><number>).
 * Supports Pakistani local numbers e.g. 03001234567 -> +923001234567.
 */
function validateAndNormalizePhone(rawPhone, defaultCountryCode = '+92') {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { isValid: false, normalized: null, error: 'Please enter a valid WhatsApp phone number.' };
  }

  const trimmed = rawPhone.trim();
  if (!trimmed) {
    return { isValid: false, normalized: null, error: 'Please enter a valid WhatsApp phone number.' };
  }

  if (/[^\d\s\-\.\(\)\+]/.test(trimmed)) {
    return { isValid: false, normalized: null, error: 'Please enter a valid WhatsApp phone number.' };
  }

  const plusCount = (trimmed.match(/\+/g) || []).length;
  if (plusCount > 1 || (plusCount === 1 && !trimmed.startsWith('+'))) {
    return { isValid: false, normalized: null, error: 'Please enter a valid WhatsApp phone number.' };
  }

  const cleaned = trimmed.replace(/[^\d\+]/g, '');

  if (cleaned.startsWith('+')) {
    const digitsOnly = cleaned.slice(1);
    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
      return { isValid: false, normalized: null, error: 'Please enter a valid WhatsApp phone number.' };
    }
    return { isValid: true, normalized: cleaned, error: null };
  } else {
    const localDigits = cleaned.replace(/^0+/, '');
    let prefix = (defaultCountryCode || '+92').trim();
    if (!prefix.startsWith('+')) prefix = '+' + prefix;

    const fullNormalized = prefix + localDigits;
    const digitsOnly = fullNormalized.slice(1);

    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
      return { isValid: false, normalized: null, error: 'Please enter a valid WhatsApp phone number.' };
    }

    return { isValid: true, normalized: fullNormalized, error: null };
  }
}

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

  const {
    customer_name,
    customer_phone,
    customer_address,
    postal_code,
    order_notes,
    items,
    idempotency_key,
    payment_method,
    country_code
  } = body;

  // Validate required fields
  if (!customer_name || !customer_name.trim()) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Customer name is required.' })
    };
  }

  if (!customer_address || !customer_address.trim()) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Complete delivery address is required.' })
    };
  }

  const normalizedPaymentMethod = (payment_method && ['ONLINE', 'COD'].includes(payment_method.toUpperCase()))
    ? payment_method.toUpperCase()
    : 'COD';

  if (!customer_phone || !customer_phone.trim()) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'WhatsApp phone number is required.' })
    };
  }

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer_phone, country_code || '+92');
  if (!phoneValidation.isValid) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: phoneValidation.error })
    };
  }
  const normalizedPhone = phoneValidation.normalized;

  if (!Array.isArray(items) || items.length === 0) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Shopping cart is empty.' })
    };
  }

  const idemKey = (idempotency_key && idempotency_key.trim())
    ? idempotency_key.trim()
    : crypto.randomUUID();

  try {
    // 1. Idempotency Check
    const existing = await query(
      `SELECT id, order_id, total_amount, shipping_fee, subtotal, order_status, payment_status, payment_method FROM orders WHERE idempotency_key = $1`,
      [idemKey]
    );

    if (existing.rows.length > 0) {
      const existingOrder = existing.rows[0];
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          replayed: true,
          order_id: existingOrder.order_id,
          subtotal: existingOrder.subtotal,
          shipping_fee: existingOrder.shipping_fee,
          total_amount: existingOrder.total_amount,
          order_status: existingOrder.order_status,
          payment_status: existingOrder.payment_status,
          payment_method: existingOrder.payment_method
        })
      };
    }

    // 2. Fetch shipping settings & city rates
    const settingsRes = await query(`SELECT standard_shipping_fee, free_shipping_threshold, city_shipping_rates FROM settings WHERE id = 1`);
    let standardShippingFee = 200;
    let freeShippingThreshold = 3500;
    let cityRates = [];

    if (settingsRes.rows.length > 0) {
      if (settingsRes.rows[0].standard_shipping_fee !== null && settingsRes.rows[0].standard_shipping_fee !== undefined) {
        standardShippingFee = parseInt(settingsRes.rows[0].standard_shipping_fee);
      }
      if (settingsRes.rows[0].free_shipping_threshold !== null && settingsRes.rows[0].free_shipping_threshold !== undefined) {
        freeShippingThreshold = parseInt(settingsRes.rows[0].free_shipping_threshold);
      }
      if (settingsRes.rows[0].city_shipping_rates) {
        try {
          cityRates = typeof settingsRes.rows[0].city_shipping_rates === 'string' ? JSON.parse(settingsRes.rows[0].city_shipping_rates) : settingsRes.rows[0].city_shipping_rates;
        } catch (e) {}
      }
    }

    // 3. Verify product availability & calculate subtotal from DB
    const productIds = items.map(item => parseInt(item.product_id)).filter(Boolean);
    if (productIds.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid product selection.' })
      };
    }

    const placeholders = productIds.map((_, i) => `$${i + 1}`).join(', ');
    const productResult = await query(
      `SELECT id, name, price, sale_price, stock_status FROM products WHERE id IN (${placeholders}) AND (is_archived = 0 OR is_archived = false OR is_archived IS NULL)`,
      productIds
    );

    const productMap = {};
    productResult.rows.forEach(p => {
      productMap[p.id] = p;
    });

    const outOfStock = [];
    for (const item of items) {
      const p = productMap[parseInt(item.product_id)];
      if (!p) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: `Product with ID ${item.product_id} was not found.` })
        };
      }
      if (p.stock_status === false || p.stock_status === 0) {
        outOfStock.push(p.name);
      }
    }

    if (outOfStock.length > 0) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          out_of_stock: true,
          error: `Sorry, the following item(s) are out of stock: ${outOfStock.join(', ')}. Please update your cart.`
        })
      };
    }

    let subtotal = 0;
    const orderLines = [];

    for (const item of items) {
      const p = productMap[parseInt(item.product_id)];
      const effectivePrice = (p.sale_price && p.sale_price > 0 && p.sale_price < p.price) ? p.sale_price : p.price;
      const qty = Math.max(1, parseInt(item.quantity) || 1);
      const lineSubtotal = effectivePrice * qty;
      subtotal += lineSubtotal;

      orderLines.push({
        product_id: p.id,
        product_name: p.name,
        price: effectivePrice,
        quantity: qty,
        subtotal: lineSubtotal
      });
    }

    // Shipping fee calculation
    let applicableShippingFee = standardShippingFee;
    const customerCity = body.customer_city || body.city || '';
    if (customerCity && Array.isArray(cityRates)) {
      const match = cityRates.find(c => c.city.toLowerCase() === customerCity.trim().toLowerCase());
      if (match && typeof match.rate === 'number') {
        applicableShippingFee = match.rate;
      }
    }

    const calculatedShippingFee = (subtotal >= freeShippingThreshold) ? 0 : applicableShippingFee;
    const grandTotal = subtotal + calculatedShippingFee;

    let fullAddress = customer_address.trim();
    if (postal_code && postal_code.trim()) {
      fullAddress += `, Postal Code: ${postal_code.trim()}`;
    }

    const generatedOrderId = 'HST-' + Math.floor(100000 + Math.random() * 900000);

    // 4. Execute single Database Transaction
    const client = await getPool().connect();
    let newOrder = null;

    try {
      await client.query('BEGIN');

      const orderResult = await client.query(
        `INSERT INTO orders (
          order_id, idempotency_key, customer_name, customer_phone, customer_address, 
          city, postal_code, subtotal, shipping_fee, total_amount, order_notes, 
          payment_method, payment_status, order_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'UNPAID', 'PENDING')
        RETURNING id, order_id, subtotal, shipping_fee, total_amount, order_status, payment_status, payment_method, created_at`,
        [
          generatedOrderId, idemKey, customer_name.trim(), normalizedPhone, fullAddress,
          customerCity || 'Other', postal_code || '', subtotal, calculatedShippingFee, grandTotal,
          order_notes || null, normalizedPaymentMethod
        ]
      );

      newOrder = orderResult.rows[0] || {
        order_id: generatedOrderId,
        subtotal,
        shipping_fee: calculatedShippingFee,
        total_amount: grandTotal,
        order_status: 'PENDING',
        payment_status: 'UNPAID',
        payment_method: normalizedPaymentMethod,
        created_at: new Date().toISOString()
      };

      const orderRefId = newOrder.id || generatedOrderId;

      for (const line of orderLines) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderRefId, line.product_id, line.product_name, line.price, line.quantity, line.subtotal]
        );
      }

      await client.query(
        `INSERT INTO order_audit_logs (order_id, action_type, old_value, new_value, performed_by)
         VALUES ($1, 'ORDER_CREATED', NULL, $2, 'CUSTOMER')`,
        [generatedOrderId, JSON.stringify({ payment_method: normalizedPaymentMethod, order_status: 'PENDING', payment_status: 'UNPAID', total: grandTotal })]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      console.error('Transaction error during order creation:', txErr);
      throw txErr;
    } finally {
      client.release();
    }

    // 5. Send Admin Email Notification
    try {
      await sendAdminOrderNotificationEmail({
        order_id: newOrder.order_id,
        customer_name: customer_name.trim(),
        customer_phone: normalizedPhone,
        customer_address: fullAddress,
        postal_code: postal_code || '',
        payment_method: normalizedPaymentMethod,
        items: orderLines,
        subtotal: subtotal,
        shipping_fee: calculatedShippingFee,
        total_amount: grandTotal,
        created_at: newOrder.created_at
      });
    } catch (emailErr) {
      console.warn(`[Order #${newOrder.order_id}] Email notification skipped or failed:`, emailErr.message);
    }

    // 6. Return successful response
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        order_id: newOrder.order_id,
        customer_name: customer_name.trim(),
        customer_phone: normalizedPhone,
        subtotal: subtotal,
        shipping_fee: calculatedShippingFee,
        total_amount: grandTotal,
        order_status: newOrder.order_status,
        payment_status: newOrder.payment_status,
        payment_method: newOrder.payment_method,
        items: orderLines
      })
    };

  } catch (err) {
    console.error('Create order error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Failed to place order. Please try again.' })
    };
  }
};

module.exports = createVercelHandler(handler);
