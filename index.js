const express = require('express');
const { google } = require('googleapis');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SHEET_ID = process.env.SHEET_ID;
const ADMIN_PIN = '123'; // ← เปลี่ยนรหัสแอดมินได้ที่นี่
const TZ = 'Asia/Bangkok';

const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// ===== util =====
async function getVoteSheet() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A:F'
  });
  return res.data.values || [];
}

// ===== GET /poll : หัวข้อ + คะแนนปัจจุบัน =====
app.get('/poll', async (req, res) => {
  try {
    const rows = await getVoteSheet();
    const topic = rows[1]?.[0] || '';
    let yes = 0, no = 0;

    for (let i = 2; i < rows.length; i++) {
      const vote = (rows[i][1] || '').toLowerCase();
      if (vote === 'yes') yes++;
      else if (vote === 'no') no++;
    }
    res.json({ topic, yes, no });
  } catch (e) {
    console.error('GET /poll', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ===== POST /topic : ตั้งหัวข้อ (เฉพาะแอดมิน) =====
app.post('/topic', async (req, res) => {
  try {
    const { topic, pin } = req.body;
    if (pin !== ADMIN_PIN) return res.status(403).json({ error: 'forbidden' });
    if (!topic || topic.trim() === '') return res.status(400).json({ error: 'missing_topic' });

    // ล้างชีทแล้ววางหัวตาราง + topic
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1'
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A1:F1',
      valueInputOption: 'RAW',
      requestBody: { values: [['Topic','Vote','Timestamp','Provider','AccountId','Name']] }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A2',
      valueInputOption: 'RAW',
      requestBody: { values: [[topic]] }
    });

    res.json({ success: true });
  } catch (e) {
    console.error('POST /topic', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ===== POST /vote : บันทึกโหวต + ตัวตน (LINE/Facebook/anonymous) =====
app.post('/vote', async (req, res) => {
  try {
    const { choice, identity } = req.body || {};
    if (!['yes', 'no'].includes(choice)) {
      return res.status(400).json({ error: 'invalid_vote' });
    }

    // identity format ที่คาดหวัง:
    // { provider: 'line'|'facebook'|'anonymous', id: '...', name: '...' }
    const provider = identity?.provider || 'anonymous';
    const id = identity?.id || '';
    const name = identity?.name || '';

    const ts = new Date().toLocaleString('th-TH', { timeZone: TZ });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:F',
      valueInputOption: 'RAW',
      requestBody: { values: [[null, choice, ts, provider, id, name]] }
    });

    res.json({ success: true });
  } catch (e) {
    console.error('POST /vote', e);
    res.status(500).json({ error: 'server_error' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server on ${PORT}`));
