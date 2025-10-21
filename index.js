// index.js
// -------------------------------
// Cloud Run: Collector + Poll API
// -------------------------------
const express = require('express');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== Config =====
const SHEET_ID = process.env.SHEET_ID;          // ตั้งค่าใน Cloud Run → Variables
const TZ = 'Asia/Bangkok';

// ===== Google Sheets client (ADC จาก Cloud Run) =====
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// ===== Utils =====
function clientIp(req) {
  const h = req.headers;
  return (
    (h['x-forwarded-for'] && h['x-forwarded-for'].split(',')[0].trim()) ||
    h['x-real-ip'] ||
    req.socket.remoteAddress
  );
}

// ===== CORS (อนุญาต Apps Script/เว็บอื่นเรียกได้) =====
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ===== POST /collector — บันทึกแถวใหม่ลงชีต =====
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
      requestBody: { values: [[ts, ip, ua, ref, payload]] },
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error /collector:', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// ===== GET /poll?topic=... — สรุปผลโหวตจากชีต =====
// จะอ่านคอลัมน์ E (Payload JSON) แล้วนับ p.vote.choice (agree/disagree) ที่ p.vote.topic ตรงกับ query
app.get('/poll', async (req, res) => {
  try {
    if (!SHEET_ID) throw new Error('SHEET_ID env is missing');
    const topic = (req.query.topic || '').trim();
    if (!topic) return res.status(400).json({ ok: false, error: 'topic is required' });

    // ดึงคอลัมน์ E ทั้งหมด (หรือจำกัดท้าย N แถวเพื่อความเร็ว)
    const N = 2000; // ปรับได้ตามขนาดข้อมูลของคุณ
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!E:E',
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
      } catch (_) {
        // ignore parse error
      }
    }

    const total = yes + no;
    const yesPct = total ? (yes * 100) / total : 0;

    res.json({ ok: true, topic, yes, no, total, yesPct });
  } catch (err) {
    console.error('Error /poll:', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// ===== Health =====
app.get('/', (req, res) => {
  res.send('IP Collector running (collector + poll).');
});

// ===== Start =====
const port = process.env.PORT || 8080;
app.listen(port, () => console.log('Listening on', port));
