// server.js
// --------- IP/Vote collector for Cloud Run + Google Sheets ---------

/* ENV ที่ต้องมี
  SHEET_ID   = <Google Sheet ID>
  ADMIN_PIN  = 123                           // ปักหมุดแก้หัวข้อ
  ALLOW_ORIGINS = comma-separated list       // (ออปชัน) origin ที่อนุญาต CORS
*/

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const APP_START = Date.now();
const PORT = process.env.PORT || 8080;
const SHEET_ID = process.env.SHEET_ID;
const ADMIN_PIN = process.env.ADMIN_PIN || '123';

// ปล่อยต้นทางที่อนุญาต (เพิ่ม/แก้ได้)
const DEFAULT_ORIGINS = [
  'https://script.google.com',
  'https://script.googleusercontent.com',
  'https://*.googleusercontent.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .concat(DEFAULT_ORIGINS);

// ---------- Google Sheets client ----------
if (!SHEET_ID) {
  console.error('❌ SHEET_ID not provided!');
  process.exit(1);
}
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// โครงสร้างชีตที่ใช้ (แนะนำให้มี 2 ชีต)
//   1) Config : เก็บ topic ปัจจุบัน (B1)
//   2) Votes  : A:Timestamp, B:User, C:Topic, D:Choice(yes|no), E:IP, F:UA, G:Ref
const CONFIG_SHEET = 'Config';
const VOTES_SHEET  = 'Votes';
const CONFIG_TOPIC_RANGE = `${CONFIG_SHEET}!B1`;
const VOTES_RANGE        = `${VOTES_SHEET}!A:G`;

// ---------- Helpers ----------
const app = express();
app.set('trust proxy', true); // เพื่อให้ req.ip ได้จาก x-forwarded-for บน Cloud Run
app.use(express.json({ limit: '1mb' }));

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow non-browser
    const ok = ALLOW_ORIGINS.some(allow => {
      if (allow.includes('*')) {
        // wild-card: simple endsWith match
        const base = allow.replace('*', '');
        return origin.endsWith(base);
      }
      return origin === allow;
    });
    cb(null, ok);
  },
  credentials: true,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Log ทุก request (ย่อ)
app.use((req, _res, next) => {
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ip=${ip}`);
  next();
});

// อ่าน topic ปัจจุบันจากชีต
async function getTopic() {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: CONFIG_TOPIC_RANGE,
  });
  const t = (r.data.values && r.data.values[0] && r.data.values[0][0]) || '';
  return String(t || '').trim();
}

// เซ็ต topic และบันทึกลงชีต
async function setTopic(topic) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: CONFIG_TOPIC_RANGE,
    valueInputOption: 'RAW',
    requestBody: { values: [[topic || '']] },
  });
}

// นับผลโหวตของ topic ปัจจุบันจากชีต Votes
async function countVotes(topic) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: VOTES_RANGE,
  });
  const rows = r.data.values || [];
  let yes = 0, no = 0;
  for (const row of rows) {
    // row = [ts, user, topic, choice, ip, ua, ref]
    if ((row[2] || '') === topic) {
      if ((row[3] || '').toLowerCase() === 'yes') yes++;
      if ((row[3] || '').toLowerCase() === 'no')  no++;
    }
  }
  return { yes, no };
}

function toThaiTimestamp(date = new Date()) {
  return date.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
}

// ---------- Routes ----------

// หน้า root แบบง่าย (health page)
app.get('/', async (_req, res, next) => {
  try {
    const topic = await getTopic();
    res
      .status(200)
      .type('text/html; charset=utf-8')
      .send(`
        <h3>✅ IP/Vote Collector is running</h3>
        <p>Uptime: ${Math.round((Date.now() - APP_START)/1000)}s</p>
        <p>Current topic: <b>${topic || '(empty)'}</b></p>
        <ul>
          <li>GET <code>/poll</code></li>
          <li>POST <code>/vote</code> {"user":"guest-1","choice":"yes"}</li>
          <li>POST <code>/topic</code> {"topic":"หัวข้อใหม่","pin":"${ADMIN_PIN}"}</li>
        </ul>
      `);
  } catch (err) { next(err); }
});

// ดึงหัวข้อ + ผลโหวต (ใช้อ่านจากหน้าเว็บ/Apps Script)
app.get('/poll', async (_req, res, next) => {
  try {
    const topic = await getTopic();
    const { yes, no } = await countVotes(topic);
    res.json({ topic, yes, no });
  } catch (err) { next(err); }
});

// ตั้ง/แก้ไขหัวข้อ (เฉพาะแอดมินที่มี PIN)
app.post('/topic', async (req, res, next) => {
  try {
    const { topic, pin } = req.body || {};
    if (String(pin) !== String(ADMIN_PIN)) {
      return res.status(403).json({ ok: false, error: 'invalid pin' });
    }
    if (!topic || !String(topic).trim()) {
      return res.status(400).json({ ok: false, error: 'topic required' });
    }
    await setTopic(String(topic).trim());
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// โหวต
app.post('/vote', async (req, res, next) => {
  try {
    const { user, choice } = req.body || {};
    const v = String(choice || '').toLowerCase().trim();
    if (!['yes', 'no'].includes(v)) {
      return res.status(400).json({ ok: false, error: 'choice must be "yes" or "no"' });
    }

    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    const ua = req.headers['user-agent'] || '';
    const ref = req.headers['referer'] || '';

    const topic = await getTopic();
    const ts = toThaiTimestamp();

    // append แถวใหม่
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: VOTES_RANGE,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[ts, user || '', topic, v, ip, ua, ref]] },
    });

    // นับใหม่แล้วตอบกลับ
    const { yes, no } = await countVotes(topic);
    res.json({ ok: true, topic, yes, no });
  } catch (err) { next(err); }
});

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'not_found', path: req.path });
});

// error handler
app.use((err, _req, res, _next) => {
  console.error('❌ Error:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
});

// start
app.listen(PORT, () => {
  console.log(`✅ Server is listening on port ${PORT}`);
});
