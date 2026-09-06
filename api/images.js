const { requireAdmin } = require('./_admin-auth');
const { v4: uuidv4 } = require('uuid');
const createVercelHandler = require('./_adapter');

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const handler = async (event) => {
  const auth = await requireAdmin(event);
  if (auth.error) return auth.response;

  const method = event.httpMethod;

  // DELETE — delete image
  if (method === 'DELETE') {
    const params = event.queryStringParameters || {};
    const key = params.key;
    if (!key || !key.startsWith('products/')) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Invalid image key.' }) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, message: 'Image deleted successfully.' }) };
  }

  // POST — upload image
  if (method === 'POST') {
    try {
      const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Content-Type must be multipart/form-data.' }) };
      }
      const boundary = contentType.split('boundary=')[1];
      if (!boundary) {
        return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Multipart boundary not found.' }) };
      }
      const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
      const { fileBuffer, mimeType } = parseMultipart(bodyBuffer, boundary);

      if (!fileBuffer) {
        return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Image file not found in request.' }) };
      }
      if (!ALLOWED_TYPES.includes(mimeType)) {
        return { statusCode: 415, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: `Unsupported file type: ${mimeType}. Use JPEG, PNG, or WebP.` }) };
      }
      if (fileBuffer.length > MAX_SIZE_BYTES) {
        return { statusCode: 413, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'File size exceeds 5 MB limit.' }) };
      }
      const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
      const base64Data = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, url: base64Data, key: `products/${uuidv4()}.${ext}`, size: fileBuffer.length, mime: mimeType })
      };
    } catch (err) {
      console.error('Upload image error:', err);
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Failed to upload image. Please try again.' }) };
    }
  }

  return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
};

function parseMultipart(buffer, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(buffer, boundaryBuffer);
  for (const part of parts) {
    if (!part.length || part.equals(Buffer.from('--\r\n')) || part.equals(Buffer.from('--'))) continue;
    const headerEnd = indexOfSequence(part, Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString('utf8');
    const fileBuffer = part.slice(headerEnd + 4, part.length - 2);
    const contentDisp = (headerStr.match(/Content-Disposition:[^\r\n]*/i) || [''])[0];
    if (!contentDisp.includes('filename') && !contentDisp.includes('name="image"')) continue;
    const mimeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
    const mimeType = mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream';
    if (fileBuffer.length > 0) return { fileBuffer, mimeType };
  }
  return { fileBuffer: null, mimeType: null };
}

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let start = 0, idx;
  while ((idx = indexOfSequence(buffer, delimiter, start)) !== -1) {
    parts.push(buffer.slice(start, idx));
    start = idx + delimiter.length + 2;
  }
  parts.push(buffer.slice(start));
  return parts;
}

function indexOfSequence(buffer, seq, offset = 0) {
  for (let i = offset; i <= buffer.length - seq.length; i++) {
    if (buffer.slice(i, i + seq.length).equals(seq)) return i;
  }
  return -1;
}

module.exports = createVercelHandler(handler);
