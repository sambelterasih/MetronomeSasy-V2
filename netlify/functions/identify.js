// Netlify Function: kenali lagu dari rekaman audio (seperti Shazam) memakai AudD.
// Butuh variabel lingkungan: AUDD_API_TOKEN (wajib). Opsional: GETSONGBPM_KEY (dipakai juga oleh bpm.js).
const bpmFn = require('./bpm');

const J = (obj) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
const KEYS = { C: 'C', 'C#': 'C#', D: 'D', 'D#': 'D#', E: 'E', F: 'F', 'F#': 'F#', G: 'G', 'G#': 'G#', A: 'A', 'A#': 'A#', B: 'B' };

async function lookupExtra(title, artist) {
  const out = { bpm: null, ts: null, key: null };
  try {
    const r = await bpmFn.handler({ httpMethod: 'GET', queryStringParameters: { title, artist }, headers: {} });
    const j = JSON.parse(r.body || '{}'); const f = (j.found || [])[0];
    if (f) { out.bpm = f.bpm || null; out.ts = f.ts || null; }
  } catch (e) { /* abaikan */ }
  const k = process.env.GETSONGBPM_KEY;
  if (k) {
    try {
      const q = encodeURIComponent('song:' + title + ' artist:' + artist);
      const s = await (await fetch('https://api.getsong.co/search/?api_key=' + k + '&type=both&lookup=' + q)).json();
      const id = s && s.search && s.search[0] && s.search[0].id;
      if (id) {
        const d = await (await fetch('https://api.getsong.co/song/?api_key=' + k + '&id=' + id)).json(); const so = d && d.song;
        if (so) {
          if (!out.bpm && so.tempo) out.bpm = Math.round(+so.tempo);
          if (!out.ts && so.time_sig) { const m = /(\d+)\s*\/\s*(\d+)/.exec(so.time_sig); if (m) out.ts = { n: +m[1], d: +m[2] }; }
          if (so.key_of) out.key = String(so.key_of).replace(/♯/g, '#').replace(/♭/g, 'b');
        }
      }
    } catch (e) { /* abaikan */ }
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return J({ ok: false, err: 'POST' });
  const token = process.env.AUDD_API_TOKEN;
  if (!token) return J({ ok: false, err: 'NO_TOKEN' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return J({ ok: false, err: 'BAD' }); }
  if (!body.audio) return J({ ok: false, err: 'BAD' });
  try {
    const buf = Buffer.from(body.audio, 'base64');
    const fd = new FormData();
    fd.append('api_token', token);
    fd.append('return', 'apple_music,spotify,deezer');
    fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'rekaman.wav');
    const res = await fetch('https://api.audd.io/', { method: 'POST', body: fd });
    const j = await res.json();
    const r = j && j.result;
    if (!r || !r.title) return J({ ok: false, err: 'NOTFOUND' });
    let dur = 0;
    if (r.apple_music && r.apple_music.durationInMillis) dur = Math.round(r.apple_music.durationInMillis / 1000);
    else if (r.spotify && r.spotify.duration_ms) dur = Math.round(r.spotify.duration_ms / 1000);
    else if (r.deezer && r.deezer.duration) dur = Math.round(+r.deezer.duration);
    const ex = await lookupExtra(r.title, r.artist || '');
    return J({ ok: true, title: r.title, artist: r.artist || '', album: r.album || '', dur: dur, bpm: ex.bpm, ts: ex.ts || null, key: ex.key });
  } catch (e) { return J({ ok: false, err: 'FAIL' }); }
};
