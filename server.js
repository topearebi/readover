import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

// Disable HTTP caching for dev and local scripts so updates are immediately picked up
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.html') || req.path.endsWith('.css') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Serve static files from root directory
app.use(express.static(__dirname));

// OAuth callback handler for popup flows (e.g. Dropbox PKCE)
app.get(['/auth/callback', '/auth/callback/'], (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>Readover Authorization</title></head>
  <body style="font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:2.5rem;background:#fbf9f5;color:#1c1917;">
    <script>
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const error = params.get('error') || params.get('error_description');
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_CODE', code, error }, '*');
        setTimeout(() => window.close(), 600);
      } else {
        window.location.href = '/';
      }
    </script>
    <h3 style="font-size:1.1rem;margin-bottom:0.5rem;">Connecting your library…</h3>
    <p style="color:#78716c;font-size:0.9rem;">Authentication successful. This window will close automatically.</p>
  </body>
</html>`);
});

// OPDS proxy endpoint to bypass CORS for self-hosted Calibre, Kavita, or remote catalogs
app.options('/api/opds-proxy', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
  res.sendStatus(204);
});

app.get('/api/opds-proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: 'Valid URL parameter starting with http:// or https:// is required' });
  }

  try {
    const headers = {};
    if (req.headers.authorization) headers['authorization'] = req.headers.authorization;
    if (req.headers.range) headers['range'] = req.headers.range;
    headers['accept'] = req.headers.accept || 'application/atom+xml, application/opds+json, application/epub+zip, application/pdf, */*';
    headers['user-agent'] = 'Readover-OPDS-Client/1.0';

    const resp = await fetch(targetUrl, { headers, redirect: 'follow' });
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
    res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Content-Disposition');
    
    if (resp.headers.get('content-type')) {
      res.setHeader('Content-Type', resp.headers.get('content-type'));
    }
    if (resp.headers.get('content-length')) {
      res.setHeader('Content-Length', resp.headers.get('content-length'));
    }
    if (resp.headers.get('content-disposition')) {
      res.setHeader('Content-Disposition', resp.headers.get('content-disposition'));
    }

    res.status(resp.status);

    if (resp.body) {
      const { Readable } = await import('stream');
      Readable.fromWeb(resp.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('OPDS Proxy Error:', err);
    res.status(502).json({ error: `Proxy failed: ${err.message}` });
  }
});

app.get('*', (req, res) => {
  res.sendFile('index.html', { root: __dirname });
});

app.listen(PORT, HOST, () => {
  console.log(`Readover server running on http://${HOST}:${PORT}`);
});
