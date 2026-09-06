const { query, getPool } = require('./_db');
const { requireAdmin } = require('./_admin-auth');
const createVercelHandler = require('./_adapter');

const ALLOWED_RETENTION_DAYS = [0, 15, 30, 45, 60, 90, 180, 365];

const NOCACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0'
};

async function runDataRetentionJob() {
  const settingsRes = await query(`SELECT customer_data_retention_days FROM settings WHERE id = 1`);
  let retentionDays = 0;
  if (settingsRes.rows.length > 0 && settingsRes.rows[0].customer_data_retention_days !== null && settingsRes.rows[0].customer_data_retention_days !== undefined) {
    retentionDays = parseInt(settingsRes.rows[0].customer_data_retention_days);
  }

  if (retentionDays === 0) {
    return {
      retention_days_used: 0,
      cleared_count: 0,
      message: 'Retention auto-delete is set to Never Delete (0 days).'
    };
  }

  // Find target orders older than retentionDays
  const targetRes = await query(
    `SELECT id, order_id FROM orders WHERE created_at <= NOW() - ($1 || ' days')::INTERVAL`,
    [retentionDays]
  );

  const targetOrders = targetRes.rows;
  if (targetOrders.length === 0) {
    return {
      retention_days_used: retentionDays,
      cleared_count: 0,
      cleared_orders: []
    };
  }

  const dbIds = targetOrders.map(o => o.id);
  const codeIds = targetOrders.map(o => o.order_id);

  // Delete whole orders and their dependencies
  await query(`DELETE FROM order_items WHERE order_id = ANY($1)`, [dbIds]);
  await query(`DELETE FROM whatsapp_notifications WHERE order_id = ANY($1) OR order_id = ANY($2)`, [dbIds, codeIds]);
  await query(`DELETE FROM order_audit_logs WHERE order_id = ANY($1) OR order_id = ANY($2)`, [dbIds, codeIds]);

  const result = await query(`DELETE FROM orders WHERE id = ANY($1)`, [dbIds]);

  return {
    retention_days_used: retentionDays,
    cleared_count: result.rowCount,
    cleared_orders: targetOrders
  };
}

const handler = async (event) => {
  const auth = await requireAdmin(event);
  if (auth.error) return auth.response;

  const method = event.httpMethod;
  const action = (event.queryStringParameters || {}).action || '';
  const adminEmail = auth.admin?.email || 'admin@handandheart.com';

  try {
    // GET — fetch settings (retention days, shipping settings, online payment instructions, city rates, promo popup)
    if (method === 'GET') {
      const result = await query(`SELECT customer_data_retention_days, standard_shipping_fee, free_shipping_threshold, online_payment_instructions, city_shipping_rates, promo_popup_enabled, promo_popup_title, promo_popup_desc FROM settings WHERE id = 1`);
      let retentionDays = 0;
      let standardShippingFee = 250;
      let freeShippingThreshold = 10000;
      let onlinePaymentInstructions = 'Please complete the payment using your preferred bank/Easypaisa/JazzCash account and send your payment screenshot to our official WhatsApp number along with your Order ID.';
      let cityShippingRates = [
        { city: "Lahore", rate: 250 },
        { city: "Karachi", rate: 250 },
        { city: "Islamabad", rate: 250 },
        { city: "Rawalpindi", rate: 250 },
        { city: "Faisalabad", rate: 250 },
        { city: "Peshawar", rate: 250 },
        { city: "Quetta", rate: 250 },
        { city: "Multan", rate: 250 },
        { city: "Sialkot", rate: 250 },
        { city: "Gujranwala", rate: 250 }
      ];
      let promoPopupEnabled = false;
      let promoPopupTitle = '';
      let promoPopupDesc = '';

      if (result.rows.length > 0) {
        const row = result.rows[0];
        if (row.customer_data_retention_days !== null && row.customer_data_retention_days !== undefined) retentionDays = parseInt(row.customer_data_retention_days);
        if (row.standard_shipping_fee !== null && row.standard_shipping_fee !== undefined) standardShippingFee = parseInt(row.standard_shipping_fee);
        if (row.free_shipping_threshold !== null && row.free_shipping_threshold !== undefined) freeShippingThreshold = parseInt(row.free_shipping_threshold);
        if (row.online_payment_instructions) onlinePaymentInstructions = row.online_payment_instructions;
        if (row.promo_popup_enabled !== undefined && row.promo_popup_enabled !== null) {
          promoPopupEnabled = row.promo_popup_enabled === true || row.promo_popup_enabled === 'true' || row.promo_popup_enabled === 1 || row.promo_popup_enabled === '1';
        }
        if (row.promo_popup_title) promoPopupTitle = row.promo_popup_title;
        if (row.promo_popup_desc) promoPopupDesc = row.promo_popup_desc;
        if (row.city_shipping_rates) {
          try {
            cityShippingRates = typeof row.city_shipping_rates === 'string' ? JSON.parse(row.city_shipping_rates) : row.city_shipping_rates;
          } catch(e) {}
        }
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          settings: {
            customer_data_retention_days: retentionDays,
            standard_shipping_fee: standardShippingFee,
            free_shipping_threshold: freeShippingThreshold,
            online_payment_instructions: onlinePaymentInstructions,
            city_shipping_rates: cityShippingRates,
            promo_popup_enabled: promoPopupEnabled,
            promo_popup_title: promoPopupTitle,
            promo_popup_desc: promoPopupDesc
          }
        })
      };
    }

    if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
      let body = {};
      if (event.body) {
        try { body = JSON.parse(event.body); } catch (e) {}
      }

      // action=log-wa-notification — Record WhatsApp notification attempt (status = OPENED)
      if (action === 'log-wa-notification') {
        const { order_id, customer_phone, message_type, message_content, order_status, payment_status } = body;
        if (!order_id || !message_type || !message_content) {
          return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'order_id, message_type, and message_content are required.' }) };
        }

        const insertRes = await query(
          `INSERT INTO whatsapp_notifications (order_id, customer_phone, message_type, message_content, order_status_at_send, payment_status_at_send, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'OPENED', NOW())
           RETURNING id, order_id, message_type, message_content, order_status_at_send, payment_status_at_send, status, created_at`,
          [order_id, customer_phone || '', message_type, message_content, order_status || 'PENDING', payment_status || 'UNPAID']
        );

        return {
          statusCode: 201,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, notification: insertRes.rows[0] })
        };
      }

      // action=confirm-wa-sent — Mark WhatsApp notification as SENT by admin
      if (action === 'confirm-wa-sent') {
        const { notification_id, order_id, order_status } = body;
        if (!notification_id && !order_id) {
          return { statusCode: 400, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'notification_id or order_id is required.' }) };
        }

        const client = await getPool().connect();
        try {
          await client.query('BEGIN');

          let targetStatus = order_status || 'SHIPPED';
          let customerPhone = '';
          let paymentStatus = 'UNPAID';

          if (order_id) {
            const ordRes = await client.query(`SELECT order_status, payment_status, customer_phone FROM orders WHERE order_id = $1 OR id::text = $1 FOR UPDATE`, [order_id]);
            if (ordRes.rows.length > 0) {
              targetStatus = order_status || ordRes.rows[0].order_status || 'SHIPPED';
              customerPhone = ordRes.rows[0].customer_phone || '';
              paymentStatus = ordRes.rows[0].payment_status || 'UNPAID';
            }
          }

          let updateRes;
          if (notification_id) {
            updateRes = await client.query(
              `UPDATE whatsapp_notifications 
               SET status = 'SENT', sent_at = NOW(), sent_by = $1, order_status_at_send = $2, message_type = $2
               WHERE id = $3 RETURNING id, order_id, message_type, order_status_at_send, status, sent_at, sent_by`,
              [adminEmail, targetStatus, notification_id]
            );
          }
          
          if ((!updateRes || updateRes.rows.length === 0) && order_id) {
            updateRes = await client.query(
              `UPDATE whatsapp_notifications 
               SET status = 'SENT', sent_at = NOW(), sent_by = $1, order_status_at_send = $2, message_type = $2
               WHERE (order_id = $3 OR order_id = (SELECT id::text FROM orders WHERE order_id = $3 LIMIT 1))
                 AND (order_status_at_send = $2 OR message_type = $2)
               RETURNING id, order_id, message_type, order_status_at_send, status, sent_at, sent_by`,
              [adminEmail, targetStatus, order_id]
            );
          }

          if ((!updateRes || updateRes.rows.length === 0) && order_id) {
            updateRes = await client.query(
              `INSERT INTO whatsapp_notifications (order_id, customer_phone, message_type, message_content, order_status_at_send, payment_status_at_send, status, sent_at, sent_by, created_at)
               VALUES ($1, $2, $3, $4, $3, $5, 'SENT', NOW(), $6, NOW())
               RETURNING id, order_id, message_type, order_status_at_send, status, sent_at, sent_by`,
              [order_id, customerPhone, targetStatus, `WhatsApp notification marked as sent for status ${targetStatus}`, paymentStatus, adminEmail]
            );
          }

          if (updateRes && updateRes.rows.length > 0) {
            const notif = updateRes.rows[0];
            await client.query(
              `INSERT INTO order_audit_logs (order_id, action_type, old_value, new_value, performed_by)
               VALUES ($1, 'WHATSAPP_MARKED_SENT', NULL, $2, $3)`,
              [notif.order_id, `Message Type: ${notif.message_type}`, adminEmail]
            );
          }

          await client.query('COMMIT');
          client.release();

          return {
            statusCode: 200,
            headers: NOCACHE_HEADERS,
            body: JSON.stringify({ success: true, notification: (updateRes && updateRes.rows.length > 0) ? updateRes.rows[0] : null })
          };
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch (rb) {}
          client.release();
          console.error('Confirm WA sent error:', err);
          return { statusCode: 500, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Failed to update WhatsApp sent status.' }) };
        }
      }

      // action=confirm-wa-not-sent — Mark WhatsApp notification as NOT_SENT
      if (action === 'confirm-wa-not-sent') {
        const { notification_id, order_id } = body;
        let updateRes;
        if (notification_id) {
          updateRes = await query(
            `UPDATE whatsapp_notifications SET status = 'NOT_SENT' WHERE id = $1 RETURNING id, order_id, message_type, status`,
            [notification_id]
          );
        } else if (order_id) {
          updateRes = await query(
            `UPDATE whatsapp_notifications SET status = 'NOT_SENT'
             WHERE id = (SELECT id FROM whatsapp_notifications WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1)
             RETURNING id, order_id, message_type, status`,
            [order_id]
          );
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, notification: updateRes.rows[0] || null })
        };
      }

      // action=run-retention — trigger retention job
      if (action === 'run-retention') {
        const info = await runDataRetentionJob();
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, ...info })
        };
      }

      // action=clear-customer — clear customer data for a specific order
      if (action === 'clear-customer') {
        let orderId = (event.queryStringParameters || {}).order_id || (event.queryStringParameters || {}).id || body.order_id || body.id;
        if (!orderId) {
          return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Order ID is required.' }) };
        }
        const result = await query(
          `UPDATE orders SET customer_name = NULL, customer_phone = NULL, customer_address = NULL, updated_at = NOW()
           WHERE order_id = $1 OR id::text = $1
           RETURNING id, order_id, customer_name, customer_phone, customer_address, order_status, payment_status, total_amount, created_at`,
          [orderId]
        );
        if (result.rows.length === 0) {
          return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Order not found.' }) };
        }

        await query(
          `INSERT INTO order_audit_logs (order_id, action_type, old_value, new_value, performed_by)
           VALUES ($1, 'CUSTOMER_DATA_DELETED', 'Active Contact Info', 'Cleared/Anonymized', $2)`,
          [orderId, adminEmail]
        );

        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, message: 'Customer contact information permanently deleted.', order: result.rows[0] }) };
      }

      // Update settings (retention days, shipping settings, online payment instructions, city rates, promo popup)
      const currentSettings = await query(`SELECT customer_data_retention_days, standard_shipping_fee, free_shipping_threshold, online_payment_instructions, city_shipping_rates, promo_popup_enabled, promo_popup_title, promo_popup_desc FROM settings WHERE id = 1`);
      let retentionDays = (currentSettings.rows[0]?.customer_data_retention_days !== null && currentSettings.rows[0]?.customer_data_retention_days !== undefined) ? parseInt(currentSettings.rows[0].customer_data_retention_days) : 0;
      let standardShippingFee = currentSettings.rows[0]?.standard_shipping_fee || 250;
      let freeShippingThreshold = currentSettings.rows[0]?.free_shipping_threshold || 10000;
      let onlinePaymentInstructions = currentSettings.rows[0]?.online_payment_instructions || 'Please complete the payment using your preferred bank/Easypaisa/JazzCash account and send your payment screenshot to our official WhatsApp number along with your Order ID.';
      let cityShippingRates = currentSettings.rows[0]?.city_shipping_rates || [
        { city: "Lahore", rate: 250 },
        { city: "Karachi", rate: 250 },
        { city: "Islamabad", rate: 250 },
        { city: "Rawalpindi", rate: 250 },
        { city: "Faisalabad", rate: 250 },
        { city: "Peshawar", rate: 250 },
        { city: "Quetta", rate: 250 },
        { city: "Multan", rate: 250 },
        { city: "Sialkot", rate: 250 },
        { city: "Gujranwala", rate: 250 }
      ];

      let promoPopupEnabled = currentSettings.rows[0]?.promo_popup_enabled !== undefined ? Boolean(currentSettings.rows[0].promo_popup_enabled) : false;
      let promoPopupTitle = currentSettings.rows[0]?.promo_popup_title || '';
      let promoPopupDesc = currentSettings.rows[0]?.promo_popup_desc || '';

      if (body.promo_popup_enabled !== undefined) {
        promoPopupEnabled = body.promo_popup_enabled === true || body.promo_popup_enabled === 'true' || body.promo_popup_enabled === 1 || body.promo_popup_enabled === '1';
      }

      if (body.promo_popup_title !== undefined) {
        promoPopupTitle = String(body.promo_popup_title).trim();
      }

      if (body.promo_popup_desc !== undefined) {
        promoPopupDesc = String(body.promo_popup_desc).trim();
      }

      if (body.customer_data_retention_days !== undefined) {
        const parsed = parseInt(body.customer_data_retention_days);
        if (isNaN(parsed) || !ALLOWED_RETENTION_DAYS.includes(parsed)) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid retention days value. Allowed values: 0 (Never), 15, 30, 45, 60, 90, 180, or 365 days.' })
          };
        }
        retentionDays = parsed;
      }

      if (body.standard_shipping_fee !== undefined) {
        const parsedFee = parseInt(body.standard_shipping_fee);
        if (isNaN(parsedFee) || parsedFee < 0) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Standard shipping fee must be a valid non-negative number.' })
          };
        }
        standardShippingFee = parsedFee;
      }

      if (body.free_shipping_threshold !== undefined) {
        const parsedThreshold = parseInt(body.free_shipping_threshold);
        if (isNaN(parsedThreshold) || parsedThreshold < 0) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Free shipping threshold must be a valid non-negative number.' })
          };
        }
        freeShippingThreshold = parsedThreshold;
      }

      if (body.online_payment_instructions !== undefined) {
        if (typeof body.online_payment_instructions === 'string') {
          onlinePaymentInstructions = body.online_payment_instructions.trim();
        }
      }

      if (body.city_shipping_rates !== undefined) {
        if (Array.isArray(body.city_shipping_rates)) {
          cityShippingRates = body.city_shipping_rates;
        }
      }

      const jsonCityRates = JSON.stringify(cityShippingRates);

      await query(
        `INSERT INTO settings (id, customer_data_retention_days, standard_shipping_fee, free_shipping_threshold, online_payment_instructions, city_shipping_rates, promo_popup_enabled, promo_popup_title, promo_popup_desc, updated_at)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (id) DO UPDATE SET
           customer_data_retention_days = EXCLUDED.customer_data_retention_days,
           standard_shipping_fee = EXCLUDED.standard_shipping_fee,
           free_shipping_threshold = EXCLUDED.free_shipping_threshold,
           online_payment_instructions = EXCLUDED.online_payment_instructions,
           city_shipping_rates = EXCLUDED.city_shipping_rates,
           promo_popup_enabled = EXCLUDED.promo_popup_enabled,
           promo_popup_title = EXCLUDED.promo_popup_title,
           promo_popup_desc = EXCLUDED.promo_popup_desc,
           updated_at = NOW()`,
        [retentionDays, standardShippingFee, freeShippingThreshold, onlinePaymentInstructions, jsonCityRates, promoPopupEnabled, promoPopupTitle, promoPopupDesc]
      );

      const updatedSettings = {
        customer_data_retention_days: retentionDays,
        standard_shipping_fee: standardShippingFee,
        free_shipping_threshold: freeShippingThreshold,
        online_payment_instructions: onlinePaymentInstructions,
        city_shipping_rates: cityShippingRates,
        promo_popup_enabled: promoPopupEnabled,
        promo_popup_title: promoPopupTitle,
        promo_popup_desc: promoPopupDesc
      };

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: 'Settings updated successfully.',
          settings: updatedSettings
        })
      };
    }

    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  } catch (err) {
    console.error('Admin data error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Processing error: ' + (err.message || err) }) };
  }
};

module.exports = createVercelHandler(handler);
module.exports.runDataRetentionJob = runDataRetentionJob;
