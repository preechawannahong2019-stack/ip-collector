const express = require('express');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SHEET_ID = process.env.SHEET_ID;              // ต้องมีค่า
const TZ = 'Asia/Bangkok';

// เตรียม client สำหรับ Google Sheets โดยใช้ Service Account ของ Cloud Run อัตโนมัติ (ADC)
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

function clientIp(req) {
  const h = req.headers;
  return (
    h['x-forwarded-for']?.split(',')[0]?.trim() ||
    h['x-real-ip'] ||
    req.socket.remoteAddress
  );
}

app.post('/collector', async (req, res) => {
  try {
    if (!SHEET_ID) throw new Error('SHEET_ID env is missing');

    const ip = clientIp(req);
    const ua = req.headers['user-agent'] || '';
    const ref = req.headers['referer'] || '';
    const payload = JSON.stringify(req.body ?? {});
    const timestamp = new Date().toLocaleString('th-TH', { timeZone: TZ });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:E',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[timestamp, ip, ua, ref, payload]] }
    });

    res.status(204).end();
  } catch (err) {
    console.error('Error writing to sheet:', err?.message || err);
    res.status(500).send('error');
  }
});

app.get('/', (req, res) =>
  res.send('IP Collector is running (Google Sheet linked)')
);

const port = process.env.PORT || 8080;
app.listen(port, () => console.log('Listening on', port));
