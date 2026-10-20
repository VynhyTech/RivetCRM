'use strict';
/**
 * RivetCRM landing server (zero dependencies, Node 18+).
 * Expects the website files inside ./public (index.html, styles.css, script.js, images, robots.txt, sitemap.xml).
 * Env: PORT, RESEND_API_KEY, CONTACT_TO, CONTACT_FROM
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 10000;

if (!fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  console.error(`Missing ${path.join(PUBLIC_DIR, 'index.html')}. Move the site files into ./public before starting.`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.txt', '.xml', '.svg']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

/* ---------- static files ---------- */
const compressedCache = new Map(); // key: file|mtime|encoding -> Buffer

async function sendFile(req, res, filePath, status = 200) {
  const ext = path.extname(filePath).toLowerCase();
  const stat = await fs.promises.stat(filePath);
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': TYPES[ext],
    ETag: etag,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400, stale-while-revalidate=604800',
    Vary: 'Accept-Encoding'
  };

  if (status === 200 && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ...SECURITY_HEADERS, ETag: etag, 'Cache-Control': headers['Cache-Control'] });
    return res.end();
  }

  let body = await fs.promises.readFile(filePath);
  const accept = String(req.headers['accept-encoding'] || '');
  const encoding = COMPRESSIBLE.has(ext) && body.length > 1024 ? (/\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null) : null;
  if (encoding) {
    const key = `${filePath}|${stat.mtimeMs}|${encoding}`;
    if (!compressedCache.has(key)) {
      compressedCache.set(key, encoding === 'br' ? zlib.brotliCompressSync(body) : zlib.gzipSync(body));
    }
    body = compressedCache.get(key);
    headers['Content-Encoding'] = encoding;
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request'); }
  if (rel.includes('\0')) return send(res, 400, 'Bad request');
  if (rel.endsWith('/')) rel += 'index.html';

  let filePath = path.resolve(PUBLIC_DIR, '.' + rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  if (path.basename(filePath).startsWith('.')) return notFound(req, res);
  if (!path.extname(filePath)) filePath += '.html'; // /privacy -> privacy.html
  if (!TYPES[path.extname(filePath).toLowerCase()]) return notFound(req, res);

  try {
    await sendFile(req, res, filePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return notFound(req, res);
    throw error;
  }
}

async function notFound(req, res) {
  const page = path.join(PUBLIC_DIR, '404.html');
  try { return await sendFile(req, res, page, 404); } catch { return send(res, 404, 'Not found'); }
}

/* ---------- contact endpoint ---------- */
const hits = new Map(); // key -> [timestamps], never longer than the limit
const WINDOW_MS = 60 * 60 * 1000;
const MAX_KEYS = 5000;
// Header that carries the real client IP. Verify it on your deployment; falls back to the socket address.
const CLIENT_IP_HEADER = (process.env.CLIENT_IP_HEADER || 'true-client-ip').toLowerCase();
const PER_IP_LIMIT = Number(process.env.CONTACT_PER_IP_LIMIT) || 10;   // counts every POST (cheap junk included)
const GLOBAL_LIMIT = Number(process.env.CONTACT_GLOBAL_LIMIT) || 40;   // counts only valid submissions

function clientKey(req) {
  const value = String(req.headers[CLIENT_IP_HEADER] || '').split(',')[0].trim().slice(0, 64);
  return `ip:${value || req.socket.remoteAddress || 'unknown'}`;
}

function overLimit(key, limit) {
  const now = Date.now();
  if (!hits.has(key) && hits.size >= MAX_KEYS) {
    for (const [k, list] of hits) if (!list.some((t) => now - t < WINDOW_MS)) hits.delete(k);
    if (hits.size >= MAX_KEYS) hits.clear(); // under sustained key-spraying, reset rather than grow
  }
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) { hits.set(key, recent); return true; } // do not record rejected attempts
  recent.push(now);
  hits.set(key, recent);
  return false;
}
setInterval(() => hits.clear(), 6 * WINDOW_MS).unref();

function readJson(req, maxBytes = 10 * 1024) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > maxBytes) return reject(Object.assign(new Error('Message too large.'), { status: 413 }));

    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (tooLarge) return; // keep draining, stop buffering
      size += chunk.length;
      if (size > maxBytes) { tooLarge = true; chunks.length = 0; return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Message too large.'), { status: 413 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const json = (res, status, data) => send(res, status, JSON.stringify(data), {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  ...(status === 413 ? { Connection: 'close' } : {})
});
const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

async function handleContact(req, res) {
  if (overLimit(clientKey(req), PER_IP_LIMIT)) return json(res, 429, { ok: false, error: 'Too many messages. Please try again later.' });

  let data;
  try { data = await readJson(req); } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message }); }

  if (!data || typeof data !== 'object' || Array.isArray(data)) return json(res, 400, { ok: false, error: 'Invalid request.' });
  if (data.hp_check) return json(res, 200, { ok: true }); // honeypot: silently drop bots (not counted globally)

  const msg = {
    name: clean(data.name, 120),
    phone: clean(data.phone, 40),
    email: clean(data.email, 160),
    agency: clean(data.agency, 160),
    comments: clean(data.comments, 2000)
  };
  if (!msg.name || !(msg.phone || msg.email)) return json(res, 422, { ok: false, error: 'Please add your name and a phone number or email.' });
  if (msg.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.email)) return json(res, 422, { ok: false, error: 'That email address looks invalid.' });

  // Only valid submissions can use up the global budget.
  if (overLimit('global', GLOBAL_LIMIT)) return json(res, 429, { ok: false, error: 'We are receiving a lot of messages right now. Please email contact@rivet-crm.com.' });

  const { RESEND_API_KEY, CONTACT_TO, CONTACT_FROM, LEADS_FILE } = process.env;
  const leadId = require('crypto').randomUUID();

  // Optional durable copy (needs a persistent disk on Render; the default filesystem is wiped on every deploy).
  if (LEADS_FILE) {
    try { await fs.promises.appendFile(LEADS_FILE, JSON.stringify({ id: leadId, at: new Date().toISOString(), ...msg }) + '\n'); }
    catch (error) { console.error(`[${leadId}] could not write lead file: ${error.code || error.message}`); }
  }

  if (!RESEND_API_KEY || !CONTACT_TO || !CONTACT_FROM) {
    console.error(`[${leadId}] contact email is not configured; lead not delivered`);
    return json(res, 503, { ok: false, error: 'Messaging is temporarily unavailable. Please email contact@rivet-crm.com.' });
  }

  const text = Object.entries(msg).map(([k, v]) => `${k}: ${v || 'n/a'}`).join('\n');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: CONTACT_FROM, to: CONTACT_TO, reply_to: msg.email || undefined, subject: `RivetCRM enquiry from ${msg.name}`, text })
  });
  if (!response.ok) {
    console.error(`[${leadId}] Resend error ${response.status}`); // no lead data in logs
    return json(res, 502, { ok: false, error: 'Could not send your message. Please try again.' });
  }
  return json(res, 200, { ok: true });
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  try {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return send(res, 400, 'Bad request'); }

    if (pathname === '/healthz') return send(res, 200, 'ok', { 'Cache-Control': 'no-store' });
    if (pathname === '/api/contact') {
      if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { Allow: 'POST' });
      return await handleContact(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return await serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) send(res, 500, 'Server error');
    else res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`RivetCRM listening on port ${PORT}`));
