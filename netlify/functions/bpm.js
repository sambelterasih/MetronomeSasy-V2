// Pencari BPM dan birama di sisi server (Netlify Function).
// Dipanggil aplikasi: /.netlify/functions/bpm?title=...&artist=...  (tempo satu lagu)
//                     /.netlify/functions/bpm?mode=songs&title=...&artist=...  (daftar lagu dari judul)
//                     /.netlify/functions/bpm?mode=artist&artist=...  (daftar lagu populer artis)
// Mengumpulkan data dari: GetSongBPM API (jika ada kunci), Deezer API, dan hasil pencarian DuckDuckGo/Bing
// untuk songbpm.com, tunebat.com, getsongbpm.com, chosic.com, musicstax.com, dan situs lain.
// Kunci GetSongBPM (opsional): variabel lingkungan GETSONGBPM_KEY di Netlify, atau header x-gsb-key dari aplikasi.
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const SITES = ['songbpm.com', 'tunebat.com', 'getsongbpm.com', 'chosic.com', 'musicstax.com'];
const NOTES = [2, 4, 8, 16];

const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const hostOf = (u) => { try { return new URL(u, 'https://x.invalid').hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

async function get(url, ms, headers) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 8000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: Object.assign({ 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' }, headers || {}) });
    return r.ok ? await r.text() : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

function parseSnippet(txt) {
  const r = {}; let m = txt.match(/(\d{2,3}(?:\.\d+)?)\s*bpm/i) || txt.match(/(?:bpm|tempo)[^0-9]{0,20}(\d{2,3})\b/i);
  if (m) { const v = Math.round(parseFloat(m[1])); if (v >= 40 && v <= 240) r.bpm = v; }
  m = txt.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  if (m && NOTES.indexOf(+m[2]) >= 0 && +m[1] >= 2 && +m[1] <= 12) r.ts = { n: +m[1], d: +m[2] };
  else { m = txt.match(/time signature[^0-9]{0,15}(\d{1,2})\b/i); if (m && +m[1] >= 2 && +m[1] <= 12) r.ts = { n: +m[1], d: 4 }; }
  return r;
}
function parseDdg(html) {
  return html.split('class="result__a"').slice(1).map((p) => {
    const h = p.match(/href="([^"]+)"/), t = p.match(/>([\s\S]*?)<\/a>/), s = p.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/), u = h && h[1].match(/uddg=([^&"]+)/);
    return { url: u ? decodeURIComponent(u[1]) : (h ? h[1] : ''), text: strip((t ? t[1] : '') + ' ' + (s ? s[1] : '')) };
  });
}
function parseBing(html) {
  return html.split('<li class="b_algo"').slice(1).map((p) => {
    const h = p.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"/); return { url: h ? h[1] : '', text: strip(p) };
  });
}

async function fromSearch(title, artist) {
  const base = artist + ' ' + title, ddg = 'https://html.duckduckgo.com/html/?q=', bing = 'https://www.bing.com/search?q=', jobs = [];
  SITES.forEach((h) => jobs.push(get(ddg + encodeURIComponent('site:' + h + ' ' + base + ' bpm')).then((x) => x && parseDdg(x))));
  jobs.push(get(ddg + encodeURIComponent(base + ' bpm tempo time signature')).then((x) => x && parseDdg(x)));
  jobs.push(get(bing + encodeURIComponent(base + ' bpm tempo')).then((x) => x && parseBing(x)));
  jobs.push(get(bing + encodeURIComponent(base + ' song key bpm time signature')).then((x) => x && parseBing(x)));
  const res = await Promise.all(jobs), nt = norm(title), na = norm(artist).split(' ')[0], seen = {}, found = []; let reached = 0;
  res.forEach((list) => {
    if (!list) return; reached++;
    list.forEach((r) => {
      const host = hostOf(r.url); if (!host || seen[host] || /duckduckgo\.com|bing\.com|microsoft\.com/.test(host)) return;
      const nx = norm(r.text); if (nx.indexOf(nt) < 0 || (na && nx.indexOf(na) < 0)) return;
      const p = parseSnippet(r.text); if (p.bpm) { seen[host] = 1; found.push({ name: host, bpm: p.bpm, ts: p.ts || null }); }
    });
  });
  return { found: found, reached: reached };
}

async function fromDeezer(title, artist) {
  const q = (artist ? 'artist:"' + artist + '" ' : '') + 'track:"' + title + '"';
  const s = await get('https://api.deezer.com/search?limit=5&q=' + encodeURIComponent(q), 7000); if (!s) return { reached: 0, found: [] };
  let list = []; try { list = JSON.parse(s).data || []; } catch (e) { /* abaikan */ }
  const nt = norm(title), na = norm(artist).split(' ')[0];
  for (const it of list) {
    if (norm(it.title).indexOf(nt) < 0 || (na && norm(it.artist && it.artist.name).indexOf(na) < 0)) continue;
    const d = await get('https://api.deezer.com/track/' + it.id, 7000); if (!d) continue;
    let b = 0; try { b = Math.round(JSON.parse(d).bpm); } catch (e) { /* abaikan */ }
    if (b >= 40 && b <= 240) return { reached: 1, found: [{ name: 'deezer.com', bpm: b, ts: null }] };
  }
  return { reached: 1, found: [] };
}

async function fromGetSongBpm(key, title, artist) {
  const lookup = artist ? 'song:' + title + ' artist:' + artist : title, type = artist ? 'both' : 'song';
  const s = await get('https://api.getsong.co/search/?api_key=' + encodeURIComponent(key) + '&limit=5&type=' + type + '&lookup=' + encodeURIComponent(lookup), 8000);
  if (!s) return { reached: 0, found: [] };
  let list = []; try { list = JSON.parse(s).search || []; } catch (e) { /* abaikan */ }
  for (const it of Array.isArray(list) ? list : []) {
    const b = Math.round(Number(it.tempo)); if (!(b >= 40 && b <= 240)) continue;
    const ts = parseSnippet('time signature ' + (it.time_sig || '')).ts || null;
    return { reached: 1, found: [{ name: 'getsongbpm.com (API)', bpm: b, ts: ts }] };
  }
  return { reached: 1, found: [] };
}

// ===== Daftar lagu (API Deezer, tanpa kunci) =====
// mode=songs&title=...&artist=... -> semua lagu yang cocok dengan judul (artis opsional)
// mode=artist&artist=...          -> lagu-lagu populer milik artis itu (maksimal 50)
async function deezerJson(url) {
  const s = await get(url, 7000); if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}
function mapTracks(list) {
  const seen = {}, out = [];
  (Array.isArray(list) ? list : []).forEach((it) => {
    if (!it || !it.title) return;
    const artist = it.artist && it.artist.name ? String(it.artist.name).trim() : '', title = String(it.title).replace(/\s+/g, ' ').trim();
    const short = String(it.title_short || it.title).replace(/\s+/g, ' ').trim(), key = norm(short) + '|' + norm(artist);
    if (seen[key]) return; seen[key] = 1;
    out.push({ title: title, short: short, artist: artist, album: it.album && it.album.title ? String(it.album.title).trim() : '' });
  });
  return out;
}
async function songsByTitle(title, artist) {
  const strict = (artist ? 'artist:"' + artist + '" ' : '') + 'track:"' + title + '"', free = (artist ? artist + ' ' : '') + title;
  const res = await Promise.all([strict, free].map((q) => deezerJson('https://api.deezer.com/search?limit=40&q=' + encodeURIComponent(q))));
  if (!res[0] && !res[1]) return { reached: 0, songs: [] };
  let all = mapTracks([].concat((res[0] && res[0].data) || [], (res[1] && res[1].data) || []));
  const toks = norm(title).split(' ').filter(Boolean), na = norm(artist);
  const ok = all.filter((x) => { const h = norm(x.title + ' ' + x.artist); return toks.every((w) => h.indexOf(w) >= 0) && (!na || norm(x.artist).indexOf(na.split(' ')[0]) >= 0); });
  if (ok.length) all = ok;   // kalau tidak ada yang cocok persis (salah ketik), tampilkan hasil mentah supaya pengguna tetap bisa memilih
  return { reached: 1, songs: all.slice(0, 30) };
}
async function songsByArtist(artist) {
  const s = await deezerJson('https://api.deezer.com/search/artist?limit=5&q=' + encodeURIComponent(artist));
  if (!s) return { reached: 0, songs: [] };
  const list = Array.isArray(s.data) ? s.data : [], na = norm(artist), a = list.find((x) => norm(x.name) === na) || list[0];
  if (!a) return { reached: 1, songs: [] };
  const t = await deezerJson('https://api.deezer.com/artist/' + a.id + '/top?limit=50');
  if (!t) return { reached: 0, songs: [] };
  return { reached: 1, artist: a.name, songs: mapTracks(t.data) };
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {}, title = String(q.title || '').trim().slice(0, 120), artist = String(q.artist || '').trim().slice(0, 120);
  const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' };
  if (q.mode === 'songs' || q.mode === 'artist') {
    if (q.mode === 'songs' ? !title : !artist) return { statusCode: 400, headers: H, body: JSON.stringify({ error: (q.mode === 'songs' ? 'title' : 'artist') + ' wajib diisi' }) };
    const r = q.mode === 'songs' ? await songsByTitle(title, artist) : await songsByArtist(artist);
    return { statusCode: 200, headers: r.songs.length ? H : Object.assign({}, H, { 'cache-control': 'no-store' }), body: JSON.stringify(r) };
  }
  if (!title) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'title wajib diisi' }) };
  const key = process.env.GETSONGBPM_KEY || (event.headers && event.headers['x-gsb-key']) || '';
  const parts = await Promise.all([fromSearch(title, artist), fromDeezer(title, artist), key ? fromGetSongBpm(key, title, artist) : { reached: 0, found: [] }]);
  const found = [], seen = {}; let reached = 0;
  parts.forEach((p) => { reached += p.reached; p.found.forEach((f) => { if (!seen[f.name]) { seen[f.name] = 1; found.push(f); } }); });
  return { statusCode: 200, headers: found.length ? H : Object.assign({}, H, { 'cache-control': 'no-store' }), body: JSON.stringify({ found: found, reached: reached }) };
};
exports._t = { parseSnippet, parseDdg, parseBing, norm, mapTracks, songsByTitle, songsByArtist };
