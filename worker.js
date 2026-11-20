// Cloudflare Worker: melayani file statis + dua fungsi server (bpm, identify).
// Memakai ulang kode di netlify/functions supaya satu sumber kode jalan di Netlify maupun Cloudflare.
import bpm from './netlify/functions/bpm.js';
import identify from './netlify/functions/identify.js';

const FN = { bpm, identify };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/\.netlify\/functions\/(bpm|identify)\/?$/);
    if (!m) return env.ASSETS.fetch(request);

    // Kode fungsi membaca process.env; isi dari variabel/secret Cloudflare.
    process.env.AUDD_API_TOKEN = env.AUDD_API_TOKEN || '';
    process.env.GETSONGBPM_KEY = env.GETSONGBPM_KEY || '';

    const event = {
      httpMethod: request.method,
      queryStringParameters: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(request.headers),
      body: request.method === 'POST' ? await request.text() : null,
    };
    try {
      const r = await FN[m[1]].handler(event);
      return new Response(r.body, { status: r.statusCode || 200, headers: r.headers || {} });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, err: 'FAIL' }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  },
};
