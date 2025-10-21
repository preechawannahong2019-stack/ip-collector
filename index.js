// index.js
const express = require('express');
const { google } = require('googleapis');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SHEET_ID = process.env.SHEET_ID;
const TZ = 'Asia/Bangkok';

// ===== Google Sheets client (ADC จาก Cloud Run) =====
const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });

// ===== ช่วยดึง IP =====
function clientIp(req) {
  const h = req.headers;
  return (h['x-forwarded-for']?.split(',')[0]?.trim())
      || h['x-real-ip']
      || req.socket.remoteAddress;
}

// ===== CORS เบื้องต้น =====
app.use((req,res,next)=>{
  res.set('Access-Control-Allow-Origin','*');
  res.set('Access-Control-Allow-Headers','Content-Type');
  res.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ===== Collector (POST) – บันทึกลงชีต พร้อม payload ที่มี vote =====
app.post('/collector', async (req, res) => {
  try {
    if (!SHEET_ID) throw new Error('SHEET_ID env is missing');
    const ip  = clientIp(req);
    const ua  = req.headers['user-agent'] || '';
    const ref = req.headers['referer'] || '';

    // timestamp ICT
    const ts = new Date().toLocaleString('th-TH', { timeZone: TZ });

    const payload = JSON.stringify(req.body || {});

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:E', // A:timestamp, B:ip, C:ua, D:ref, E:payload(JSON)
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[ts, ip, ua, ref, payload]],
      },
    });

    // สำเร็จ – อาจตอบสั้น ๆ 204 หรือ 200
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false, error:String(err.message||err) });
  }
});

// ===== Poll Result (GET) – คืนสรุปคะแนนของ topic =====
// รูปแบบ: GET /poll?topic=xxx
app.get('/poll', async (req, res) => {
  try {
    if (!SHEET_ID) throw new Error('SHEET_ID env is missing');
    const topic = (req.query.topic || '').trim();
    if (!topic) return res.status(400).json({ ok:false, error:'topic is required' });

    // ดึงคอลัมน์ E (Payload) ทั้งหมด หรือจำกัดล่าสุด N แถวเพื่อความเร็ว
    // ปรับ N ได้ตามขนาดชีตของคุณ
    const N = 2000;

    const meta = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!E:E',
    });

    const rows = (meta.data.values || []).flat().slice(-N);
    let yes = 0, no = 0;

    for (const raw of rows) {
      if (!raw) continue;
      try {
        const p = JSON.parse(raw);
        if (p?.vote?.topic && p.vote.topic.trim() === topic) {
          if (p.vote.choice === 'agree') yes++;
          else if (p.vote.choice === 'disagree') no++;
        }
      } catch(e) { /* ignore parse errors */ }
    }

    const total = yes + no;
    const yesPct = total ? (yes * 100) / total : 0;

    res.json({ ok:true, topic, yes, no, total, yesPct });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false, error:String(err.message||err) });
  }
});

// ===== Health / root =====
app.get('/', (req, res) => res.send('IP Collector running.'));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log('Listening on', port));
