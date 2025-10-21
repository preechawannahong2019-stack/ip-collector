// index.js — Cloud Run: Collector + Poll + Topic (admin)
const express = require('express');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== Config =====
const SHEET_ID = process.env.SHEET_ID;           // ต้องตั้งใน Cloud Run
const TZ = 'Asia/Bangkok';
const ADMIN_PASS = process.env.ADMIN_PASS || '1+2+3+';  // คุณกำหนดตามที่ต้องการได้

// ===== Google Sheets client (ใช้ ADC ของ Cloud Run) =====
const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });

// ===== Utils =====
function clientIp(req) {
  const h = req.headers;
  return (h['x-forwarded-for']?.split(',')[0]?.trim()) || h['x-real-ip'] || req.socket.remoteAddress;
}

async function getSpreadsheetMeta() {
  const g = google.sheets({ version: 'v4', auth });
  const resp = await g.spreadsheets.get({ spreadsheetId: SHEET_ID });
  return resp.data;
}

async function ensureConfigSheet() {
  const meta = await getSpreadsheetMeta();
  const has = (meta.sheets || []).some(s => s.properties?.title === 'Config');
  if (has) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: 'Config' } } }] }
  });
  // ใส่หัวตารางเบื้องต้น (A1 = "Topic", A2 = "")
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Config!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [['Topic'], ['']] }
  });
}

async function getCurrentTopic() {
  try {
    await ensureConfigSheet();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Config!A2' });
    const val = (resp.data.values && resp.data.values[0] && resp.data.values[0][0]) || '';
    return String(val || '').trim();
  } catch (e) {
    console.error('getCurrentTopic error:', e.message || e);
    return '';
  }
}

async function setCurrentTopic(newTopic) {
  await ensureConfigSheet();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Config!A2',
    valueInputOption: 'RAW',
    requestBody: { values: [[newTopic]] }
  });
}

// ===== CORS =====
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*'); // ปรับเป็นโดเมนที่อนุญาตถ้าใช้จริง
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ===== Health =====
app.get('/', (req, res) => res.send('IP Collector running (collector + poll + topic).'));

// ===== Topic endpoints =====
// GET /topic      → { ok:true, topic }
// POST /topic     → body: { code, topic }  (admin only)
app.get('/topic', async (req, res) => {
  try {
    if (!SHEET_ID) throw new Error('SHEET_ID env is missing');
    const topic = await getCurrentTopic();
    res.json({ ok: true, topic });
  } catch (err) {
    console.error('GET /topic error:', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/topic', async (req, res) => {
  try {
    if (!SHEET_ID) throw new Error('SHEET_ID env is missing');
    const code = String(req.body?.code || '');
    const topic = String(req.body?.topic || '').trim();
    if (!topic) return res.status(400).json({ ok: false, error: 'topic is required' });
    if (code !== ADMIN_PASS) return res.status(403).json({ ok: false, error: 'forbidden' });
    await setCurrentTopic(topic);
    res.json({ ok: true, topic });
  } catch (err) {
    console.error('POST /topic error:', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// ===== Collector (POST) — บันทึกหลักฐานลง Sheet1 =====
// A: Timestamp (ICT) | B: IP | C: UA | D: Referer | E: Payload(JSON)
app.post('/collector', async (req, res) => {
  try {
    if (!SHEET_ID) throw new Error('SHEET_ID env is missing');

    const ip = clientIp(req);
    const ua = req.headers['user-agent'] || '';
    const ref = req.headers['referer'] || '';
    const ts = new Date().toLocaleString('th-TH', { timeZone: TZ });
    const payload = JSON.stringify(req.body || {});

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:E',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[ts, ip, ua, ref, payload]] }
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error /collector:', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// ===== Poll Result (GET) — /poll?topic=... =====
app.get('/poll', async (req, res) => {
  try {
    if (!SHEET_ID) throw new Error('SHEET_ID env is missing');
    const topic = (req.query.topic || '').trim();
    if (!topic) return res.status(400).json({ ok: false, error: 'topic is required' });

    // อ่านคอลัมน์ E (Payload) ช่วงท้าย N แถวเพื่อความเร็ว
    const N = 2000;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: 'Sheet1!E:E'
    });

    const values = resp.data.values || [];
    const payloadCol = values.map(r => (Array.isArray(r) ? r[0] : r)).slice(-N);

    let yes = 0, no = 0;
    for (const raw of payloadCol) {
      if (!raw) continue;
      try {
        const p = JSON.parse(raw);
        if (p?.vote?.topic && p.vote.topic.trim() === topic) {
          if (p.vote.choice === 'agree') yes++;
          else if (p.vote.choice === 'disagree') no++;
        }
      } catch (_) { /* ignore */ }
    }
    const total = yes + no;
    const yesPct = total ? (yes * 100) / total : 0;
    res.json({ ok: true, topic, yes, no, total, yesPct });
  } catch (err) {
    console.error('Error /poll:', err);
    res.status(500).json({ ok:false, error: String(err.message || err) });
  }
});

// ===== Start =====
const port = process.env.PORT || 8080;
app.listen(port, () => console.log('Listening on', port));
