// Nahar · serveur de notifications (Cloudflare Worker)
// Auteur : Eyoub Bouarfa
//
// L'appli calcule elle-même ses rappels des 30 prochains jours (horaires, jeûnes)
// et les envoie ici avec son abonnement. Le serveur ne connaît ni la ville ni la
// position : seulement des heures et des textes. Chaque minute, il envoie les
// rappels arrivés à échéance (Web Push chiffré, RFC 8291 et 8292).
//
// Liaisons : base D1 nommée DB. Déclencheur : cron « * * * * * ».
// Les clés d'envoi sont créées automatiquement au premier appel.

const SUBJECT = "https://eyoubbouarfa.github.io/yawm/";
const MAX_EVENTS = 400;
const LATE_MS = 15 * 60000; // un rappel en retard de plus de 15 min n'est plus envoyé

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type" };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...CORS } });

let READY = null;
function init(env) {
  if (!READY) READY = env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS conf(k TEXT PRIMARY KEY, v TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS subs(id TEXT PRIMARY KEY, sub TEXT NOT NULL, updated INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, sid TEXT NOT NULL, t INTEGER NOT NULL, title TEXT, body TEXT, tag TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ev_t ON events(t)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ev_sid ON events(sid)")
  ]).catch(e => { READY = null; throw e; });
  return READY;
}

let KEYS = null;
async function keys(env) {
  if (KEYS) return KEYS;
  let row = await env.DB.prepare("SELECT v FROM conf WHERE k='vapid'").first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    await env.DB.prepare("INSERT OR IGNORE INTO conf(k,v) VALUES('vapid',?)").bind(JSON.stringify(jwk)).run();
    row = await env.DB.prepare("SELECT v FROM conf WHERE k='vapid'").first();
  }
  const jwk = JSON.parse(row.v);
  const priv = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const pub = b64u(concat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y)));
  return (KEYS = { priv, pub });
}

async function sha(s) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map(b => b.toString(16).padStart(2, "0")).join(""); }

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}

// Chiffrement aes128gcm (RFC 8291)
export async function encrypt(sub, payload) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const ua = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ua }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

// Jeton VAPID (RFC 8292)
export async function vapid(endpoint, k) {
  const aud = new URL(endpoint).origin;
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k.priv, enc.encode(h + "." + p));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${k.pub}`;
}

async function send(env, sub, msg) {
  const k = await keys(env);
  const body = await encrypt(sub, JSON.stringify(msg));
  return fetch(sub.endpoint, {
    method: "POST",
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "900", Urgency: "high", Authorization: await vapid(sub.endpoint, k) },
    body
  });
}

function validSub(s) {
  return s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";
}

async function forget(env, sid) {
  await env.DB.batch([env.DB.prepare("DELETE FROM events WHERE sid=?").bind(sid), env.DB.prepare("DELETE FROM subs WHERE id=?").bind(sid)]);
}

async function run(env) {
  await init(env);
  const now = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT e.id, e.sid, e.t, e.title, e.body, e.tag, s.sub FROM events e JOIN subs s ON s.id = e.sid WHERE e.t <= ? ORDER BY e.t LIMIT 300"
  ).bind(now + 20000).all();
  const done = [], gone = new Set();
  await Promise.all(results.map(async r => {
    done.push(r.id);
    if (r.t < now - LATE_MS || gone.has(r.sid)) return;
    try {
      const res = await send(env, JSON.parse(r.sub), { title: r.title, body: r.body, tag: r.tag });
      if (res.status === 404 || res.status === 410) gone.add(r.sid);
    } catch (e) {}
  }));
  const stmts = done.map(id => env.DB.prepare("DELETE FROM events WHERE id=?").bind(id));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  for (const sid of gone) await forget(env, sid);
  // abonnements abandonnés : ni rappel ni mise à jour depuis 60 jours
  if (new Date(now).getUTCMinutes() === 7 && new Date(now).getUTCHours() === 3)
    await env.DB.prepare("DELETE FROM subs WHERE updated < ? AND id NOT IN (SELECT DISTINCT sid FROM events)").bind(now - 60 * 864e5).run();
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    try {
      await init(env);
      if (req.method === "GET" && url.pathname === "/key") return json({ key: (await keys(env)).pub });
      if (req.method === "GET" && url.pathname === "/") return json({ ok: true, service: "Nahar notifications" });
      if (req.method !== "POST") return json({ error: "méthode" }, 405);
      const d = await req.json();
      if (url.pathname === "/schedule") {
        if (!validSub(d.sub) || !Array.isArray(d.events)) return json({ error: "données" }, 400);
        const now = Date.now(), sid = await sha(d.sub.endpoint);
        const ev = d.events.filter(e => e && Number.isFinite(e.t) && e.t > now - 60000 && e.t < now + 45 * 864e5)
          .slice(0, MAX_EVENTS)
          .map(e => [Math.round(e.t), String(e.ti || "").slice(0, 120), String(e.b || "").slice(0, 400), String(e.tg || "").slice(0, 40)]);
        const st = [
          env.DB.prepare("INSERT OR REPLACE INTO subs(id, sub, updated) VALUES(?,?,?)").bind(sid, JSON.stringify({ endpoint: d.sub.endpoint, keys: { p256dh: d.sub.keys.p256dh, auth: d.sub.keys.auth } }), now),
          env.DB.prepare("DELETE FROM events WHERE sid=?").bind(sid),
          ...ev.map(e => env.DB.prepare("INSERT INTO events(sid, t, title, body, tag) VALUES(?,?,?,?,?)").bind(sid, ...e))
        ];
        for (let i = 0; i < st.length; i += 100) await env.DB.batch(st.slice(i, i + 100));
        return json({ ok: true, n: ev.length });
      }
      if (url.pathname === "/test") {
        if (!validSub(d.sub)) return json({ error: "données" }, 400);
        const res = await send(env, d.sub, { title: "Nahar", body: "Les notifications fonctionnent.", tag: "test" });
        return json({ ok: res.ok, status: res.status }, res.ok ? 200 : 502);
      }
      if (url.pathname === "/unsubscribe") {
        if (typeof d.endpoint !== "string") return json({ error: "données" }, 400);
        await forget(env, await sha(d.endpoint));
        return json({ ok: true });
      }
      return json({ error: "introuvable" }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
  async scheduled(ev, env, ctx) { ctx.waitUntil(run(env)); }
};
