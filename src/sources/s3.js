// AWS S3 and Cloudflare R2 source adapter for Readover.
// Optimized as dedicated attachment & book storage (EPUBs, PDFs, and media).
// Uses pure JavaScript AWS Signature Version 4 (SigV4) via Web Crypto API (zero npm dependencies).

export const canWrite = (src) => Boolean(src.endpoint && src.bucket && src.accessKeyId && src.secretAccessKey);

/* ---------- Lightweight Web Crypto SigV4 Signer ---------- */

async function sha256Hex(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmac(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    typeof data === 'string' ? new TextEncoder().encode(data) : data
  );
  return new Uint8Array(signature);
}

async function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate = await hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/** Signs and executes an AWS SigV4 HTTP request against S3 or Cloudflare R2. */
async function signedFetch(src, method, rawPathAndQuery, { headers = {}, body = null } = {}) {
  const endpoint = (src.endpoint || '').replace(/\/+$/, '');
  const bucket = src.bucket.trim();
  const region = (src.region || 'auto').trim();
  const service = 's3';

  // Support both virtual-hosted and path-style URLs:
  // If endpoint is a generic service endpoint (e.g. r2.cloudflarestorage.com or s3.amazonaws.com),
  // path-style: ${endpoint}/${bucket}/${path}
  const urlObj = new URL(endpoint);
  let requestHost = urlObj.host;
  let canonicalUri = `/${bucket}${rawPathAndQuery.split('?')[0]}`;
  let canonicalQuery = rawPathAndQuery.includes('?') ? rawPathAndQuery.split('?')[1] : '';

  // Sort query parameters
  if (canonicalQuery) {
    const params = new URLSearchParams(canonicalQuery);
    const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    canonicalQuery = sorted.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = body ? await sha256Hex(body) : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const reqHeaders = {
    host: requestHost,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...headers,
  };

  const signedHeaderKeys = Object.keys(reqHeaders)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderKeys
    .map((k) => `${k}:${String(reqHeaders[k] || reqHeaders[Object.keys(reqHeaders).find((orig) => orig.toLowerCase() === k)]).trim()}\n`)
    .join('');
  const signedHeadersStr = signedHeaderKeys.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeadersStr,
    payloadHash,
  ].join('\n');

  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${hashedCanonicalRequest}`;

  const signingKey = await getSignatureKey(src.secretAccessKey, dateStamp, region, service);
  const signatureBytes = await hmac(signingKey, stringToSign);
  const signature = Array.from(signatureBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${src.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  const fullUrl = `${endpoint}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`;

  let res;
  try {
    res = await fetch(fullUrl, {
      method,
      headers: {
        ...reqHeaders,
        Authorization: authHeader,
      },
      body,
    });
  } catch (err) {
    if (err.name === 'TypeError' || err.message.includes('Failed to fetch')) {
      throw new Error(
        'Could not reach S3/R2 bucket. Please check that your bucket has CORS enabled allowing GET, PUT, HEAD from this domain.'
      );
    }
    throw err;
  }

  return res;
}

/* ---------- S3 Adapter Operations ---------- */

export async function listFiles(src, accept = () => true, onProgress = () => {}) {
  const root = (src.root || '').replace(/^\/+|\/+$/g, '');
  const prefixParam = root ? `&prefix=${encodeURIComponent(root + '/')}` : '';
  const query = `list-type=2${prefixParam}`;

  const res = await signedFetch(src, 'GET', `/?${query}`);
  if (res.status === 403) throw new Error('S3/R2 Access Denied. Check your Access Key ID, Secret Key, and Bucket permissions.');
  if (res.status === 404) throw new Error(`Bucket "${src.bucket}" not found.`);
  if (!res.ok) throw new Error(`S3/R2 listing failed with status ${res.status}`);

  const xmlText = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const contents = Array.from(doc.querySelectorAll('Contents'));
  const files = [];

  for (const item of contents) {
    const keyEl = item.querySelector('Key');
    const sizeEl = item.querySelector('Size');
    const etagEl = item.querySelector('ETag');

    if (!keyEl) continue;
    let path = keyEl.textContent.trim();
    if (root && path.startsWith(`${root}/`)) {
      path = path.slice(root.length + 1);
    }

    if (!path || path.endsWith('/')) continue; // Skip directory markers

    const size = sizeEl ? Number(sizeEl.textContent) || 0 : 0;
    const etag = etagEl ? etagEl.textContent.replace(/"/g, '').trim() : `${Date.now()}`;

    if (accept(path)) {
      files.push({
        path,
        sha: etag,
        size,
      });
    }
  }

  return files;
}

export async function readBlob(src, item, type = '') {
  const root = (src.root || '').replace(/^\/+|\/+$/g, '');
  const fullPath = root ? `/${root}/${item.path.replace(/^\/+/, '')}` : `/${item.path.replace(/^\/+/, '')}`;

  const res = await signedFetch(src, 'GET', fullPath);
  if (!res.ok) throw new Error(`S3/R2 read failed (${res.status})`);
  const buf = await res.arrayBuffer();
  return new Blob([buf], { type });
}

export async function readText(src, item) {
  const blob = await readBlob(src, item, 'text/plain');
  return blob.text();
}

export async function putFile(src, path, textOrBlob) {
  const root = (src.root || '').replace(/^\/+|\/+$/g, '');
  const fullPath = root ? `/${root}/${path.replace(/^\/+/, '')}` : `/${path.replace(/^\/+/, '')}`;

  const body = typeof textOrBlob === 'string' ? new TextEncoder().encode(textOrBlob) : textOrBlob;
  const isBinary = !(typeof textOrBlob === 'string');

  const res = await signedFetch(src, 'PUT', fullPath, {
    headers: {
      'content-type': isBinary ? 'application/octet-stream' : 'text/markdown; charset=utf-8',
    },
    body,
  });

  if (!res.ok) throw new Error(`S3/R2 upload failed (${res.status})`);
  const etag = res.headers.get('ETag') || '';
  return etag.replace(/"/g, '') || `sha:${Date.now()}`;
}

export async function testConnection(src) {
  const res = await signedFetch(src, 'GET', '/?list-type=2&max-keys=1');
  if (!res.ok) throw new Error(`Bucket responded with error code ${res.status}`);
  return true;
}
