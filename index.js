// index.js
const express = require('express');
const { google } = require('googleapis');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ตั้งค่า Google Sheet
const SHEET_ID = process.env.SHEET_ID;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const auth = new google.auth.GoogleAuth({
  scopes: SCOPES,
});
const sheets = google.sheets({ version: 'v4', auth });

// ดึง IP ของผู้เข้าใช้งาน
function clientIp(req) {
  const h = req.headers;
  return (
    h['x-forwarded-for']?.split(',')[0]?.trim() ||
    h['x-real-ip'] ||
    req.socket.remoteAddress
  );
}

// จุดรับ POST ข้อมูล
app.post('/collector', async (req, res) => {
  try {
    const ip = clientIp(req);
    const ua = req.headers['user-agent'];
    const ref = req.headers['referer'] || '';
    const payload = JSON.stringify(req.body);
    const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:E',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[timestamp, ip, ua, ref, payload]],
      },
    });

    res.status(204).end();
  } catch (err) {
    console.error('Error writing to sheet:', err);
    res.status(500).send('Error');
  }
});

app.get('/', (req, res) => {
  res.send('✅ IP Collector connected to Google Sheet');
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log('Listening on port', port));
