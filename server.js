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


app.get('*', (req, res) => {
  res.sendFile('index.html', { root: __dirname });
});

app.listen(PORT, HOST, () => {
  console.log(`Readover server running on http://${HOST}:${PORT}`);
});
