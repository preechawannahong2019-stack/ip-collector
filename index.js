const express = require('express');
const { google } = require('googleapis');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SHEET_ID = process.env.SHEET_ID;
const ADMIN_PIN = '123'; // ← ปรับรหัสแอดมินได้ตรงนี้
const TZ = 'Asia/Bangkok';

const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// =================== Utility ===================
async function getVoteSheet() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A:E'
  });
  return res.data.values || [];
}

// =================== API: ดึงหัวข้อโหวต ===================
app.get('/poll', async (req, res) => {
  try {
    const rows = await getVoteSheet();
    const topic = rows[1]?.[0] || '';
    let yes = 0, no = 0;

    for (let i = 2; i < rows.length; i++) {
      const vote = rows[i][1];
      if (vote === 'yes') yes++;
      else if (vote === 'no') no++;
    }

    res.json({ topic, yes, no });
  } catch (err) {
    console.error('GET /poll error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// =================== API: ตั้งหัวข้อ (เฉพาะแอดมิน) ===================
app.post('/topic', async (req, res) => {
  try {
    const { topic, pin } = req.body;
    if (pin !== ADMIN_PIN) return res.status(403).json({ error: 'forbidden' });
    if (!topic || topic.trim() === '') return res.status(400).json({ error: 'missing_topic' });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1'
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A1:B1',
      valueInputOption: 'RAW',
      requestBody: { values: [['Topic', 'Vote']] }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A2',
      valueInputOption: 'RAW',
      requestBody: { values: [[topic]] }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('POST /topic error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// =================== API: บันทึกการโหวต ===================
app.post('/vote', async (req, res) => {
  try {
    const { choice } = req.body;
    if (!['yes', 'no'].includes(choice)) {
      return res.status(400).json({ error: 'invalid_vote' });
    }

    const ts = new Date().toLocaleString('th-TH', { timeZone: TZ });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:E',
      valueInputOption: 'RAW',
      requestBody: { values: [[null, choice, ts]] }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('POST /vote error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
