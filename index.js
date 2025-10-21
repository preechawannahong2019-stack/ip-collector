// ===== index.js =====
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');

const app = express();

// ✅ 1. เปิดใช้งาน CORS ให้รองรับ Apps Script
app.use(cors({
  origin: '*', // ถ้าต้องการจำกัดให้เฉพาะโดเมน Apps Script: ['https://script.google.com', /\.googleusercontent\.com$/]
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// ✅ 2. ตั้งค่าให้ตอบ preflight request (OPTIONS)
app.options('/collector', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.status(204).end();
});

// ✅ 3. ใช้งาน JSON parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ 4. อ่านค่าตัวแปรสิ่งแวดล้อม
const SHEET_ID = process.env.SHEET_ID; // ต้องตั้งใน Cloud Run
const TZ = 'Asia/Bangkok';

// ✅ 5. ตั้งค่า Client สำหรับ Google Sheets API
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// ✅ 6. ดึง IP จาก Header
function clientIp(req) {
  const h = req.headers;
  return (
    (h['x-forwarded-for'] || '').split(',')[0].trim() ||
    h['x-real-ip'] ||
    req.socket.remoteAddress
  );
}

// ✅ 7. Route หลัก: POST /collector
app.post('/collector', async (req, res) => {
  try {
    if (!SHEET_ID) throw new Error('SHEET_ID environment variable is missing');

    const ip = clientIp(req);
    const ua = req.headers['user-agent'] || '';
    const ref = req.headers['referer'] || '';
    const payload = JSON.stringify(req.body || {});
    const timestamp = new Date().toLocaleString('th-TH', { timeZone: TZ });

    // ✅ เขียนข้อมูลลง Google Sheets
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:E',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[timestamp, ip, ua, ref, payload]]
      }
    });

    console.log(`✅ Logged: ${ip}`);
    res.status(200).send({ status: 'success', ip });
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).send({ status: 'error', message: err.message });
  }
});

// ✅ 8. เริ่มเซิร์ฟเวอร์
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
