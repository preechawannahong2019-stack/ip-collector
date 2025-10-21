const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(cors());

const SHEET_ID = process.env.SHEET_ID;
const ADMIN_PIN = process.env.ADMIN_PIN || '123';
const TZ = process.env.TZ || 'Asia/Bangkok';

const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

const NOW_TH = () => new Date().toLocaleString('th-TH', { timeZone: TZ });

// ---------- helpers ----------
async function getCurrentTopic() {
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Config!A1',
    });
    const v = (r.data.values && r.data.values[0] && r.data.values[0][0]) || '';
    return String(v || '').trim();
  } catch (e) {
    return '';
  }
}

async function setCurrentTopic(topic) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Config!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [[topic]] },
  });
}

async function countVotes(topic) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!C:D', // C=Topic, D=Choice
  });
  const values = r.data.values || [];
  let yes = 0, no = 0;
  for (const row of values) {
    const rowTopic = (row[0] || '').trim();
    const choice = (row[1] || '').trim().toLowerCase();
    if (rowTopic === topic) {
      if (choice === 'yes') yes++;
      else if (choice === 'no') no++;
    }
  }
  return { yes, no };
}

// ---------- routes ----------
app.get('/', (req, res) => {
  res
    .status(200)
    .type('text/html; charset=utf-8')
    .send(`<h3>IP Collector is running ✅</h3><p><a href="/poll">/poll</a></p>`);
});

// ดูหัวข้อ + ผลโหวต
app.get('/poll', async (req, res) => {
  try {
    const topic = await getCurrentTopic();
    if (!topic) return res.json({ ok: true, topic: '', yes: 0, no: 0 });
    const { yes, no } = await countVotes(topic);
    res.json({ ok: true, topic, yes, no });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ตั้ง/เปลี่ยนหัวข้อ (เฉพาะแอดมิน)
app.post('/topic', async (req, res) => {
  try {
    const { topic, pin } = req.body || {};
    if (pin !== ADMIN_PIN) return res.status(403).json({ ok: false, error: 'invalid pin' });
    const title = String(topic || '').trim();
    if (!title) return res.status(400).json({ ok: false, error: 'missing topic' });

    await setCurrentTopic(title);
    const { yes, no } = await countVotes(title);
    res.json({ ok: true, topic: title, yes, no });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ลงคะแนน
app.post('/vote', async (req, res) => {
  try {
    const { user, choice } = req.body || {};
    const v = String(choice || '').toLowerCase();
    if (v !== 'yes' && v !== 'no') {
      return res.status(400).json({ ok: false, error: 'choice must be "yes" or "no"' });
    }
    const topic = await getCurrentTopic();
    if (!topic) return res.status(400).json({ ok: false, error: 'no active topic' });

    const ip  = (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '';
    const ua  = req.headers['user-agent'] || '';
    const ref = req.headers['referer'] || '';
    const ts  = NOW_TH();

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:G',            // <<--- 7 คอลัมน์ A..G
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[ts, user || '', topic, v, ip, ua, ref]] },
    });

    const { yes, no } = await countVotes(topic);
    res.json({ ok: true, topic, yes, no });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Server running on port', PORT));
