const { query, getPool } = require('./_db');
const { requireAdmin } = require('./_admin-auth');
const createVercelHandler = require('./_adapter');

const VALID_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'READY', 'SHIPPED', 'COMPLETED', 'CANCELLED'];
const VALID_PAYMENT_STATUSES = ['UNPAID', 'PAID', 'FAILED', 'REFUNDED'];

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
  const adminEmail = auth.admin?.email || 'admin@handandheart.com';

  // GET — list orders with filters, item details, notification history & stats
  if (method === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const searchQ = (params.q || params.search || '').trim();
      const orderStatus = (params.status || params.order_status || '').trim();
      const paymentStatus = (params.payment_status || '').trim();
      const paymentMethod = (params.payment_method || '').trim();
      const startDate = (params.start_date || '').trim();
      const endDate = (params.end_date || '').trim();
      const fetchItems = params.fetch_items === 'true' || params.id || params.order_id;

      const page = Math.max(1, parseInt(params.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 15));
      const offset = (page - 1) * limit;

      let whereClauses = [];
      const values = [];
      let paramCount = 1;

      if (searchQ) {
        whereClauses.push(`(o.order_id ILIKE $${paramCount} OR o.customer_name ILIKE $${paramCount} OR o.customer_phone ILIKE $${paramCount})`);
        values.push(`%${searchQ}%`);
        paramCount++;
      }
      if (orderStatus) {
        whereClauses.push(`o.order_status = $${paramCount}`);
        values.push(orderStatus);
        paramCount++;
      }
      if (paymentStatus) {
        whereClauses.push(`o.payment_status = $${paramCount}`);
        values.push(paymentStatus);
        paramCount++;
      }
      if (paymentMethod) {
        whereClauses.push(`o.payment_method = $${paramCount}`);
        values.push(paymentMethod);
        paramCount++;
      }
      if (startDate) {
        whereClauses.push(`o.created_at >= $${paramCount}::timestamp`);
        values.push(`${startDate} 00:00:00`);
        paramCount++;
      }
      if (endDate) {
        whereClauses.push(`o.created_at <= $${paramCount}::timestamp`);
        values.push(`${endDate} 23:59:59.999`);
        paramCount++;
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const countSql = `SELECT COUNT(*) FROM orders o ${whereSql}`;
      const dataSql = `
        SELECT o.id, o.order_id, o.customer_name, o.customer_phone, o.customer_address,
               o.subtotal, o.shipping_fee, o.total_amount, o.order_notes,
               o.payment_method, o.payment_status, o.payment_verified_at, o.payment_verified_by,
               o.payment_received_at, o.payment_received_by, o.order_status,
               o.created_at, o.completed_at, o.cancelled_at,
               COUNT(oi.id) as item_count
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        ${whereSql}
        GROUP BY o.id
        ORDER BY o.created_at DESC
        LIMIT $${paramCount} OFFSET $${paramCount + 1}
      `;
      const dataValues = [...values, limit, offset];

      const [countResult, dataResult] = await Promise.all([
        query(countSql, values),
        query(dataSql, dataValues)
      ]);

      const total = parseInt(countResult.rows[0].count);
      let orders = dataResult.rows.map(row => ({
        ...row,
        total_amount_formatted: 'Rs. ' + Number(row.total_amount).toLocaleString('en-US')
      }));

      // Fetch items, notification history & audit logs if requested
      if (fetchItems && orders.length > 0) {
        const orderDbIds = orders.map(o => o.id);
        const orderCodeIds = orders.map(o => o.order_id);

        const [itemsResult, notificationsResult, auditLogsResult] = await Promise.all([
          query(
            `SELECT id, order_id, product_id, product_name, price, quantity, subtotal FROM order_items WHERE order_id = ANY($1)`,
            [orderDbIds]
          ),
          query(
            `SELECT id, order_id, customer_phone, message_type, message_content, order_status_at_send, payment_status_at_send, status, sent_at, sent_by, created_at
             FROM whatsapp_notifications WHERE order_id = ANY($1) ORDER BY created_at DESC`,
            [orderCodeIds]
          ),
          query(
            `SELECT id, order_id, action_type, old_value, new_value, performed_by, created_at
             FROM order_audit_logs WHERE order_id = ANY($1) ORDER BY created_at DESC LIMIT 100`,
            [orderCodeIds]
          )
        ]);

        const itemsMap = {};
        itemsResult.rows.forEach(item => {
          if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
          itemsMap[item.order_id].push(item);
        });

        const notificationsMap = {};
        notificationsResult.rows.forEach(n => {
          if (!notificationsMap[n.order_id]) notificationsMap[n.order_id] = [];
          notificationsMap[n.order_id].push(n);
        });

        const auditLogsMap = {};
        auditLogsResult.rows.forEach(a => {
          if (!auditLogsMap[a.order_id]) auditLogsMap[a.order_id] = [];
          auditLogsMap[a.order_id].push(a);
        });

        orders = orders.map(o => ({
          ...o,
          items: itemsMap[o.id] || [],
          notifications: notificationsMap[o.order_id] || [],
          last_notification: (notificationsMap[o.order_id] && notificationsMap[o.order_id].length > 0) ? notificationsMap[o.order_id][0] : null,
          has_sent_notification_for_current_status: (notificationsMap[o.order_id] || []).some(n => n.status === 'SENT' && n.order_status_at_send === o.order_status),
          audit_logs: auditLogsMap[o.order_id] || []
        }));
      }

      const statsResult = await query(`
        SELECT 
          COUNT(*) FILTER (WHERE order_status = 'PENDING') as pending_count,
          COUNT(*) FILTER (WHERE order_status = 'CONFIRMED') as confirmed_count,
          COUNT(*) FILTER (WHERE order_status = 'COMPLETED') as completed_count,
          COUNT(*) FILTER (WHERE payment_status = 'UNPAID') as unpaid_count,
          COUNT(*) FILTER (WHERE payment_method = 'ONLINE' AND payment_status = 'UNPAID' AND order_status != 'CANCELLED') as unverified_online_count,
          COUNT(*) FILTER (WHERE payment_method = 'COD' AND payment_status = 'UNPAID' AND order_status != 'CANCELLED') as cod_pending_count,
          COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as today_count,
          COALESCE(SUM(total_amount) FILTER (WHERE order_status != 'CANCELLED'), 0) as total_revenue
        FROM orders
      `);

      const shippedUnnotifiedResult = await query(`
        SELECT COUNT(DISTINCT o.id) as shipped_unnotified_count
        FROM orders o
        WHERE o.order_status = 'SHIPPED'
        AND NOT EXISTS (
          SELECT 1 FROM whatsapp_notifications wn 
          WHERE wn.order_id = o.order_id AND wn.status = 'SENT' AND wn.order_status_at_send = 'SHIPPED'
        )
      `);

      return {
        statusCode: 200,
        headers: NOCACHE_HEADERS,
        body: JSON.stringify({
          success: true,
          orders,
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
          summary: {
            total_orders: total,
            ...statsResult.rows[0],
            shipped_unnotified_count: parseInt(shippedUnnotifiedResult.rows[0]?.shipped_unnotified_count || 0)
          }
        })
      };
    } catch (err) {
      console.error('Admin get-orders error:', err);
      return { statusCode: 500, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Failed to retrieve order records.' }) };
    }
  }

  // ── DELETION HANDLER (Single, Bulk, Range) ──────────────────
  const actionParam = (event.queryStringParameters?.action || '').toLowerCase();
  let parsedBody = {};
  if (event.body) {
    try { parsedBody = JSON.parse(event.body); } catch (e) {}
  }
  const bodyAction = (parsedBody.action || '').toLowerCase();
  const isDeleteAction = method === 'DELETE' || actionParam === 'delete-order' || actionParam === 'delete-range' || actionParam === 'bulk-delete' || bodyAction === 'delete-order' || bodyAction === 'delete-range' || bodyAction === 'bulk-delete';

  if (isDeleteAction) {
    const action = actionParam || bodyAction;
    const params = event.queryStringParameters || {};
    const body = parsedBody;

    // 1. Action: Delete Date Range
    if (action === 'delete-range') {
      const startDate = (body.start_date || params.start_date || '').trim();
      const endDate = (body.end_date || params.end_date || '').trim();

      if (!startDate || !endDate) {
        return { statusCode: 400, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Start date and end date are required for date range deletion.' }) };
      }

      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const targetRes = await client.query(
          `SELECT id, order_id FROM orders WHERE created_at >= $1::timestamp AND created_at <= $2::timestamp FOR UPDATE`,
          [`${startDate} 00:00:00`, `${endDate} 23:59:59.999`]
        );
        const targetOrders = targetRes.rows;
        if (targetOrders.length === 0) {
          await client.query('ROLLBACK');
          client.release();
          return { statusCode: 200, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: true, count: 0, message: 'No orders found within the specified date range.' }) };
        }

        const dbIds = targetOrders.map(o => o.id);
        const codeIds = targetOrders.map(o => o.order_id);

        await client.query(`DELETE FROM order_items WHERE order_id = ANY($1)`, [dbIds]);
        await client.query(`DELETE FROM whatsapp_notifications WHERE order_id = ANY($1) OR order_id = ANY($2)`, [dbIds, codeIds]);
        await client.query(`DELETE FROM order_audit_logs WHERE order_id = ANY($1) OR order_id = ANY($2)`, [dbIds, codeIds]);
        const delRes = await client.query(`DELETE FROM orders WHERE id = ANY($1)`, [dbIds]);

        await client.query('COMMIT');
        client.release();

        return {
          statusCode: 200,
          headers: NOCACHE_HEADERS,
          body: JSON.stringify({
            success: true,
            deleted_count: delRes.rowCount,
            message: `Successfully deleted ${delRes.rowCount} orders created between ${startDate} and ${endDate}.`
          })
        };
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rb) {}
        client.release();
        console.error('Admin delete date range error:', err);
        return { statusCode: 500, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Failed to delete orders in date range.' }) };
      }
    }

    // 2. Action: Delete Selected Array of Orders (Multi-select)
    const orderIdsArr = body.order_ids || body.ids || (Array.isArray(body.id) ? body.id : null);
    if (Array.isArray(orderIdsArr) && orderIdsArr.length > 0) {
      const strIds = orderIdsArr.map(id => String(id));
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const targetRes = await client.query(
          `SELECT id, order_id FROM orders WHERE id::text = ANY($1) OR order_id = ANY($1) FOR UPDATE`,
          [strIds]
        );
        const targetOrders = targetRes.rows;
        if (targetOrders.length === 0) {
          await client.query('ROLLBACK');
          client.release();
          return { statusCode: 200, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: true, deleted_count: 0, message: 'No matching orders found to delete.' }) };
        }

        const dbIds = targetOrders.map(o => o.id);
        const codeIds = targetOrders.map(o => o.order_id);

        await client.query(`DELETE FROM order_items WHERE order_id = ANY($1)`, [dbIds]);
        await client.query(`DELETE FROM whatsapp_notifications WHERE order_id = ANY($1) OR order_id = ANY($2)`, [dbIds, codeIds]);
        await client.query(`DELETE FROM order_audit_logs WHERE order_id = ANY($1) OR order_id = ANY($2)`, [dbIds, codeIds]);
        const delRes = await client.query(`DELETE FROM orders WHERE id = ANY($1)`, [dbIds]);

        await client.query('COMMIT');
        client.release();

        return {
          statusCode: 200,
          headers: NOCACHE_HEADERS,
          body: JSON.stringify({
            success: true,
            deleted_count: delRes.rowCount,
            message: `Successfully deleted ${delRes.rowCount} selected orders.`
          })
        };
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rb) {}
        client.release();
        console.error('Admin bulk delete orders error:', err);
        return { statusCode: 500, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Failed to delete selected orders.' }) };
      }
    }

    // 3. Action: Delete Single Order
    const targetId = body.order_id || body.id || params.order_id || params.id;
    if (!targetId) {
      return { statusCode: 400, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Order ID is required for deletion.' }) };
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const ordRes = await client.query(`SELECT id, order_id FROM orders WHERE id::text = $1 OR order_id = $1 FOR UPDATE`, [String(targetId)]);
      if (ordRes.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return { statusCode: 404, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Order not found.' }) };
      }

      const ord = ordRes.rows[0];

      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [ord.id]);
      await client.query(`DELETE FROM whatsapp_notifications WHERE order_id = $1 OR order_id = $2`, [ord.id, ord.order_id]);
      await client.query(`DELETE FROM order_audit_logs WHERE order_id = $1 OR order_id = $2`, [ord.id, ord.order_id]);
      await client.query(`DELETE FROM orders WHERE id = $1`, [ord.id]);

      await client.query('COMMIT');
      client.release();

      return {
        statusCode: 200,
        headers: NOCACHE_HEADERS,
        body: JSON.stringify({
          success: true,
          deleted_id: ord.order_id,
          message: `Order #${ord.order_id} deleted successfully.`
        })
      };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (rb) {}
      client.release();
      console.error('Admin delete single order error:', err);
      return { statusCode: 500, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Failed to delete order.' }) };
    }
  }

  // ── POST — Update order/payment status or execute payment actions ────
  if (method === 'POST') {
    const body = parsedBody;
    const action = body.action || '';
    const { order_id, order_status, payment_status, payment_method } = body;

    if (!order_id) {
      return { statusCode: 400, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'order_id is required.' }) };
    }

    // Action: Verify Online Payment
    if (action === 'verify-online-payment') {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const existingOrderRes = await client.query(`SELECT id, order_id, order_status, payment_status, payment_method FROM orders WHERE order_id = $1 OR id::text = $1 FOR UPDATE`, [order_id]);
        if (existingOrderRes.rows.length === 0) {
          await client.query('ROLLBACK');
          client.release();
          return { statusCode: 404, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Order not found.' }) };
        }
        const currentOrder = existingOrderRes.rows[0];
        const now = new Date().toISOString();

        const res = await client.query(
          `UPDATE orders SET payment_status = 'PAID', payment_verified_at = $1, payment_verified_by = $2, updated_at = $1
           WHERE id = $3 RETURNING id, order_id, order_status, payment_status, payment_method, payment_verified_at, payment_verified_by`,
          [now, adminEmail, currentOrder.id]
        );
        await client.query(
          `INSERT INTO order_audit_logs (order_id, action_type, old_value, new_value, performed_by)
           VALUES ($1, 'VERIFY_ONLINE_PAYMENT', $2, $3, $4)`,
          [currentOrder.order_id, currentOrder.payment_status, 'PAID', adminEmail]
        );

        await client.query('COMMIT');
        client.release();
        return { statusCode: 200, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: true, message: 'Online payment verified successfully.', order: res.rows[0] }) };
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rb) {}
        client.release();
        console.error('Admin verify-online-payment error:', err);
        return { statusCode: 500, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Failed to verify payment.' }) };
      }
    }

    // Action: Mark COD Cash as Received
    if (action === 'mark-cod-received') {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const existingOrderRes = await client.query(`SELECT id, order_id, order_status, payment_status, payment_method FROM orders WHERE order_id = $1 OR id::text = $1 FOR UPDATE`, [order_id]);
        if (existingOrderRes.rows.length === 0) {
          await client.query('ROLLBACK');
          client.release();
          return { statusCode: 404, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Order not found.' }) };
        }
        const currentOrder = existingOrderRes.rows[0];
        const now = new Date().toISOString();

        const res = await client.query(
          `UPDATE orders SET payment_status = 'PAID', payment_received_at = $1, payment_received_by = $2, updated_at = $1
           WHERE id = $3 RETURNING id, order_id, order_status, payment_status, payment_method, payment_received_at, payment_received_by`,
          [now, adminEmail, currentOrder.id]
        );
        await client.query(
          `INSERT INTO order_audit_logs (order_id, action_type, old_value, new_value, performed_by)
           VALUES ($1, 'MARK_COD_RECEIVED', $2, $3, $4)`,
          [currentOrder.order_id, currentOrder.payment_status, 'PAID', adminEmail]
        );

        await client.query('COMMIT');
        client.release();
        return { statusCode: 200, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: true, message: 'COD payment recorded as received.', order: res.rows[0] }) };
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rb) {}
        client.release();
        console.error('Admin mark-cod-received error:', err);
        return { statusCode: 500, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Failed to record COD payment.' }) };
      }
    }

    // Regular Status / Payment Method Update
    if (order_status && !VALID_ORDER_STATUSES.includes(order_status)) {
      return { statusCode: 400, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: `Invalid order status: ${order_status}` }) };
    }
    if (payment_status && !VALID_PAYMENT_STATUSES.includes(payment_status)) {
      return { statusCode: 400, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: `Invalid payment status: ${payment_status}` }) };
    }
    if (payment_method && !['COD', 'ONLINE'].includes(payment_method.toUpperCase())) {
      return { statusCode: 400, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: `Invalid payment method: ${payment_method}` }) };
    }

    const client = await getPool().connect();

    try {
      await client.query('BEGIN');

      const existingOrderRes = await client.query(
        `SELECT id, order_id, order_status, payment_status, payment_method FROM orders WHERE order_id = $1 OR id::text = $1 FOR UPDATE`,
        [order_id]
      );
      if (existingOrderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return { statusCode: 404, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Order not found.' }) };
      }
      const currentOrder = existingOrderRes.rows[0];

      const setClauses = [];
      const values = [];
      let i = 1;

      if (payment_method && payment_method.toUpperCase() !== currentOrder.payment_method) {
        const normMethod = payment_method.toUpperCase();
        setClauses.push(`payment_method = $${i++}`); values.push(normMethod);
        await client.query(
          `INSERT INTO order_audit_logs (order_id, action_type, old_value, new_value, performed_by)
           VALUES ($1, 'PAYMENT_METHOD_CHANGED', $2, $3, $4)`,
          [currentOrder.order_id, currentOrder.payment_method, normMethod, adminEmail]
        );
      }

      if (order_status && order_status !== currentOrder.order_status) {
        setClauses.push(`order_status = $${i++}`);
        values.push(order_status);
        if (order_status === 'COMPLETED') { setClauses.push(`completed_at = $${i++}`); values.push(new Date().toISOString()); }
        else if (order_status === 'CANCELLED') { setClauses.push(`cancelled_at = $${i++}`); values.push(new Date().toISOString()); }

        await client.query(
          `INSERT INTO order_audit_logs (order_id, action_type, old_value, new_value, performed_by)
           VALUES ($1, 'ORDER_STATUS_CHANGED', $2, $3, $4)`,
          [currentOrder.order_id, currentOrder.order_status, order_status, adminEmail]
        );
      }

      if (payment_status && payment_status !== currentOrder.payment_status) {
        setClauses.push(`payment_status = $${i++}`); values.push(payment_status);
        if (payment_status === 'PAID') {
          if (currentOrder.payment_method === 'ONLINE') {
            setClauses.push(`payment_verified_at = $${i++}`); values.push(new Date().toISOString());
            setClauses.push(`payment_verified_by = $${i++}`); values.push(adminEmail);
          } else {
            setClauses.push(`payment_received_at = $${i++}`); values.push(new Date().toISOString());
            setClauses.push(`payment_received_by = $${i++}`); values.push(adminEmail);
          }
        }

        await client.query(
          `INSERT INTO order_audit_logs (order_id, action_type, old_value, new_value, performed_by)
           VALUES ($1, 'PAYMENT_STATUS_CHANGED', $2, $3, $4)`,
          [currentOrder.order_id, currentOrder.payment_status, payment_status, adminEmail]
        );
      }

      setClauses.push(`updated_at = $${i++}`); values.push(new Date().toISOString());

      if (setClauses.length === 1) {
        await client.query('COMMIT');
        client.release();
        return { statusCode: 200, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: true, message: 'No status changes required.', order: currentOrder }) };
      }

      values.push(currentOrder.id);
      const result = await client.query(
        `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING id, order_id, order_status, payment_status, payment_method, completed_at, cancelled_at, updated_at`,
        values
      );

      await client.query('COMMIT');
      client.release();

      return { statusCode: 200, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: true, order: result.rows[0] }) };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (rbErr) {}
      client.release();
      console.error('Admin update-order-status error:', err);
      return { statusCode: 500, headers: NOCACHE_HEADERS, body: JSON.stringify({ success: false, error: 'Failed to update order status.' }) };
    }
  }

  return { statusCode: 405, headers: NOCACHE_HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
};

module.exports = createVercelHandler(handler);
