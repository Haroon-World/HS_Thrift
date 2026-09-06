module.exports = function createVercelHandler(handler) {
  return async (req, res) => {
    // Standardize query params
    const queryStringParameters = req.query || {};

    // Standardize body (parsed object or string)
    let body = req.body;
    if (typeof body === 'object' && body !== null) {
      body = JSON.stringify(body);
    } else if (typeof body !== 'string') {
      body = '';
    }

    const event = {
      httpMethod: req.method,
      headers: req.headers || {},
      queryStringParameters,
      body
    };

    try {
      const response = await handler(event);

      if (response.headers) {
        Object.entries(response.headers).forEach(([k, v]) => {
          res.setHeader(k, v);
        });
      }

      const statusCode = response.statusCode || 200;
      res.status(statusCode);

      if (response.body) {
        try {
          const parsed = JSON.parse(response.body);
          res.json(parsed);
        } catch (e) {
          res.send(response.body);
        }
      } else {
        res.end();
      }
    } catch (err) {
      console.error('Vercel API error:', err);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  };
};
