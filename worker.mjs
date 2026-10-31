import { handleApi } from './backend.mjs';
import shell from 'virtual:app-shell';

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        const response = await handleApi(request, env);
        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
        headers.set('Cache-Control', 'no-store');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      } catch (error) {
        console.error('API request failed:', error?.message || 'Unknown error');
        return Response.json({ error: 'The server could not complete this request. Please retry.' }, { status: 500, headers: { ...securityHeaders, 'Cache-Control': 'no-store' } });
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', ...securityHeaders } });
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain', ...securityHeaders } });
    return new Response(request.method === 'HEAD' ? null : shell, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...securityHeaders } });
  },
};
