const nodemailer = require('nodemailer');

/**
 * Sends an administrative email notification when a new order is created.
 * Recipient defaults to handandheart09@gmail.com or process.env.ADMIN_EMAIL.
 *
 * Supports two email dispatch methods:
 * 1. Resend API (if process.env.RESEND_API_KEY is configured)
 * 2. SMTP / Nodemailer (if process.env.SMTP_HOST, SMTP_USER, SMTP_PASS are configured)
 *
 * If credentials are missing or email fails, logs the event cleanly
 * without throwing an exception to ensure order creation flow never breaks.
 */
async function sendAdminOrderNotificationEmail(orderData) {
  const adminEmail = process.env.ADMIN_EMAIL || 'hsthrift59@gmail.com';
  const resendApiKey = process.env.RESEND_API_KEY;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const {
    order_id,
    customer_name,
    customer_phone,
    customer_address,
    postal_code,
    payment_method = 'COD',
    items = [],
    subtotal = 0,
    shipping_fee = 0,
    total_amount = 0,
    created_at
  } = orderData;

  const formattedDate = created_at ? new Date(created_at).toLocaleString('en-US') : new Date().toLocaleString('en-US');
  const cleanPhone = String(customer_phone || '').replace(/[^0-9]/g, '');
  const paymentMethodLabel = payment_method === 'ONLINE' ? 'Online Payment' : 'Cash on Delivery (COD)';
  const isCOD = payment_method === 'COD';
  const payInstructionsText = isCOD 
    ? 'Your order will be processed shortly for Cash on Delivery.' 
    : 'Please complete your payment using your preferred bank/Easypaisa/JazzCash account and send the payment screenshot to us on WhatsApp (+92 319 715071) so that we can verify your payment and proceed with your order.';

  let itemsText = '';
  let itemsHtml = '';
  items.forEach(item => {
    const name = item.product_name || item.name;
    const qty = item.quantity;
    const price = item.price || 0;
    const lineTotal = price * qty;
    itemsText += `• ${name} × ${qty} — Rs. ${Number(lineTotal).toLocaleString('en-US')}\n`;
    itemsHtml += `<tr>
      <td style="padding: 8px; border-bottom: 1px solid #eeeeee;">${name}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eeeeee; text-align: center;">${qty}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eeeeee; text-align: right;">Rs. ${Number(lineTotal).toLocaleString('en-US')}</td>
    </tr>`;
  });

  const waPreWrittenMsg = `Hello ${customer_name || 'Valued Customer'}! 🔥

Thank you for your order #${order_id} from HS_Thrift.

Payment Method: ${paymentMethodLabel}
Payment Status: UNPAID
Order Total: Rs. ${Number(total_amount).toLocaleString('en-US')}

Order Details:
${itemsText}
Delivery Address:
${customer_address || 'Provided address'}

${payInstructionsText}

HS_Thrift — Curated Streetwear & Vintage Finds.`;

  const waLink = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waPreWrittenMsg)}` : '#';

  const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL 
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` 
    : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const adminOrderUrl = `${baseUrl}/admin/orders.html?id=${order_id}`;

  const subject = `🛍️ New Order Notification — #${order_id} | HS_Thrift`;

  const textContent = `
NEW ORDER RECEIVED — HS_Thrift

Order ID: #${order_id}
Date/Time: ${formattedDate}
Payment Method: ${paymentMethodLabel}
Order Status: PENDING
Payment Status: UNPAID

CUSTOMER DETAILS:
• Full Name: ${customer_name}
• WhatsApp / Phone: ${customer_phone}
• Delivery Address: ${customer_address}
• Postal Code: ${postal_code || 'Not provided'}

PRE-WRITTEN WHATSAPP MESSAGE FOR CUSTOMER:
----------------------------------------
${waPreWrittenMsg}
----------------------------------------

CUSTOMER WHATSAPP CLICK-TO-CHAT LINK:
${waLink}

ITEMS ORDERED:
${itemsText}
FINANCIAL SUMMARY:
• Subtotal: Rs. ${Number(subtotal).toLocaleString('en-US')}
• Shipping Fee: ${shipping_fee === 0 ? 'FREE (Promo)' : 'Rs. ' + Number(shipping_fee).toLocaleString('en-US')}
• Grand Total: Rs. ${Number(total_amount).toLocaleString('en-US')}

Log in to Admin Panel:
${adminOrderUrl}
  `.trim();

  const htmlContent = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #222222; border: 1px solid #e0e0e0; border-radius: 8px; padding: 24px; background-color: #ffffff;">
  <h2 style="color: #c17c3a; margin-top: 0;">🛍️ New Order Received</h2>
  <p style="font-size: 14px; color: #666666;">Order ID: <strong>#${order_id}</strong> &bull; ${formattedDate}</p>

  <div style="background-color: #f9f8f6; border-radius: 6px; padding: 16px; margin-bottom: 20px;">
    <h3 style="margin-top: 0; font-size: 16px; color: #333333;">Customer Details</h3>
    <p style="margin: 4px 0;"><strong>Name:</strong> ${customer_name}</p>
    <p style="margin: 4px 0;"><strong>Phone:</strong> ${customer_phone}</p>
    <p style="margin: 4px 0;"><strong>Address:</strong> ${customer_address}</p>
    <p style="margin: 4px 0;"><strong>Postal Code:</strong> ${postal_code || 'N/A'}</p>
    <p style="margin: 4px 0;"><strong>Payment Method:</strong> <span style="color: #c17c3a; font-weight: bold;">${paymentMethodLabel}</span> (UNPAID)</p>

    ${cleanPhone ? `
      <div style="margin-top: 14px;">
        <a href="${waLink}" target="_blank" style="background-color: #25D366; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block; box-shadow: 0 2px 6px rgba(37,211,102,0.3);">
          💬 Send Professional Confirmation Message on WhatsApp
        </a>
      </div>
    ` : ''}
  </div>

  <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 14px; margin-bottom: 20px;">
    <h4 style="margin-top: 0; margin-bottom: 8px; color: #166534; font-size: 14px;">Pre-Written WhatsApp Message:</h4>
    <div style="font-size: 13px; color: #14532d; white-space: pre-wrap; font-family: monospace; background: #ffffff; padding: 10px; border-radius: 4px; border: 1px solid #dcfce7;">${waPreWrittenMsg}</div>
  </div>

  <h3 style="font-size: 16px; color: #333333;">Items Ordered</h3>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
    <thead>
      <tr style="background-color: #f2f0eb;">
        <th style="padding: 8px; text-align: left;">Item</th>
        <th style="padding: 8px; text-align: center;">Qty</th>
        <th style="padding: 8px; text-align: right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <div style="text-align: right; font-size: 14px; margin-bottom: 24px;">
    <p style="margin: 4px 0;">Subtotal: <strong>Rs. ${Number(subtotal).toLocaleString('en-US')}</strong></p>
    <p style="margin: 4px 0;">Shipping Fee: <strong>${shipping_fee === 0 ? 'FREE' : 'Rs. ' + Number(shipping_fee).toLocaleString('en-US')}</strong></p>
    <p style="margin: 8px 0; font-size: 18px; color: #c17c3a;">Grand Total: <strong>Rs. ${Number(total_amount).toLocaleString('en-US')}</strong></p>
  </div>

  <div style="border-top: 1px solid #eeeeee; padding-top: 16px; text-align: center;">
    <a href="${adminOrderUrl}" target="_blank" style="color: #c17c3a; font-weight: bold; font-size: 14px;">Open Order in Admin Dashboard &rarr;</a>
  </div>
</div>
  `.trim();

  // Method 1: Resend API (HTTP fetch)
  if (resendApiKey) {
    try {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Hand & Heart Studio <onboarding@resend.dev>',
          to: [adminEmail],
          subject: subject,
          text: textContent,
          html: htmlContent
        })
      });

      const resendData = await resendRes.json();
      if (resendRes.ok) {
        console.log(`[Admin Email Notification] Email sent via Resend API to ${adminEmail} for order #${order_id}. ID: ${resendData.id}`);
        return { success: true, method: 'resend', id: resendData.id };
      } else {
        console.error(`[Admin Email Notification] Resend API error:`, resendData);
      }
    } catch (resendErr) {
      console.error(`[Admin Email Notification] Resend API request failed:`, resendErr.message);
    }
  }

  // Method 2: SMTP / Nodemailer
  if (host && user && pass) {
    const transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port === 465,
      auth: {
        user: user,
        pass: pass
      }
    });

    try {
      const info = await transporter.sendMail({
        from: `"Hand & Heart Studio" <${user}>`,
        to: adminEmail,
        subject: subject,
        text: textContent,
        html: htmlContent
      });

      console.log(`[Admin Email Notification] Email sent via SMTP to ${adminEmail} for order #${order_id}. MessageID: ${info.messageId}`);
      return { success: true, method: 'smtp', messageId: info.messageId };
    } catch (err) {
      console.error(`[Admin Email Notification] Failed to send email via SMTP for order #${order_id}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  console.warn('[Admin Email Notification] Email dispatch skipped because neither RESEND_API_KEY nor SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) are set in Vercel.', {
    recipient: adminEmail
  });

  return { success: false, skipped: true, reason: 'No email credentials (RESEND_API_KEY or SMTP) configured in Vercel' };
}

/**
 * Sends an administrative email notification when a customer submits a contact form message.
 */
async function sendContactFormEmail(contactData) {
  const adminEmail = process.env.ADMIN_EMAIL || 'handandheart09@gmail.com';
  const resendApiKey = process.env.RESEND_API_KEY;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const { name, contact, subject = 'General Inquiry', message, created_at } = contactData;
  const formattedDate = created_at ? new Date(created_at).toLocaleString('en-US') : new Date().toLocaleString('en-US');

  const emailSubject = `📩 Contact Form Message from ${name} | Hand & Heart Studio`;

  const textContent = `
NEW CONTACT FORM MESSAGE RECEIVED

From: ${name}
Contact Info: ${contact}
Subject: ${subject}
Date/Time: ${formattedDate}

Message:
----------------------------------------
${message}
----------------------------------------
  `.trim();

  const htmlContent = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #222222; border: 1px solid #e0e0e0; border-radius: 8px; padding: 24px; background-color: #ffffff;">
  <h2 style="color: #c85a67; margin-top: 0;">📩 New Contact Form Message</h2>
  <p style="font-size: 14px; color: #666666;">Received on ${formattedDate}</p>

  <div style="background-color: #f9f8f6; border-radius: 6px; padding: 16px; margin-bottom: 20px;">
    <p style="margin: 6px 0;"><strong>Sender Name:</strong> ${name}</p>
    <p style="margin: 6px 0;"><strong>Contact Info:</strong> ${contact}</p>
    <p style="margin: 6px 0;"><strong>Subject:</strong> ${subject}</p>
  </div>

  <h3 style="font-size: 15px; color: #333333; margin-bottom: 8px;">Message Content:</h3>
  <div style="background-color: #ffffff; border: 1px solid #e8ddd1; border-radius: 6px; padding: 16px; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${message}</div>

  <div style="margin-top: 20px; border-top: 1px solid #eeeeee; padding-top: 16px; text-align: center;">
    <a href="https://handandheartpk.vercel.app/admin/dashboard.html" target="_blank" style="color: #c85a67; font-weight: bold; font-size: 14px;">Open Admin Dashboard &rarr;</a>
  </div>
</div>
  `.trim();

  if (resendApiKey) {
    try {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Hand & Heart Studio <onboarding@resend.dev>',
          to: [adminEmail],
          subject: emailSubject,
          text: textContent,
          html: htmlContent
        })
      });
      const resendData = await resendRes.json();
      if (resendRes.ok) {
        console.log(`[Contact Email] Sent via Resend to ${adminEmail}. ID: ${resendData.id}`);
        return { success: true, method: 'resend', id: resendData.id };
      } else {
        console.error(`[Contact Email] Resend error:`, resendData);
      }
    } catch (e) {
      console.error(`[Contact Email] Resend request failed:`, e.message);
    }
  }

  if (host && user && pass) {
    const transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port === 465,
      auth: { user, pass }
    });
    try {
      const info = await transporter.sendMail({
        from: `"Hand & Heart Studio" <${user}>`,
        to: adminEmail,
        subject: emailSubject,
        text: textContent,
        html: htmlContent
      });
      console.log(`[Contact Email] Sent via SMTP to ${adminEmail}. ID: ${info.messageId}`);
      return { success: true, method: 'smtp', messageId: info.messageId };
    } catch (err) {
      console.error(`[Contact Email] SMTP failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  console.warn('[Contact Email] Email skipped (No RESEND_API_KEY or SMTP configured in Vercel).', { recipient: adminEmail });
  return { success: false, skipped: true };
}

module.exports = {
  sendAdminOrderNotificationEmail,
  sendContactFormEmail
};
