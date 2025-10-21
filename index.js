// index.js
const express = require('express');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SHEET_ID = process.env.SHEET_ID;            // <<< ตั้งค่าใน Cloud Run
const ADMIN_PASS = process.env.ADMIN_PASS || '123';  // <<< เปลี่ยนรหัสแอดมินที่นี่/หรือผ่าน Env

const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// -------------------------- helpers --------------------------
async function ensureSheets() {
  // แนะนำให้มี 2 ชีต: Poll (เก็บหัวข้อ), Votes (บันทึกคะแนน)
  // Poll!A1 = หัวข้อโหวต, Poll!B1 = updatedAt
  // Votes = [ts, ip, ua, topic, choice]
}

async function getCurrentTopic() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Poll!A1:B1',
  });
  const row = res.data.values?.[0] || [];
  return {
    topic: (row[0] || '').trim(),
    updatedAt: row[1] || '',
  };
}

async function setCurrentTopic(newTopic) {
  const now = new Date().toISOString();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Poll!A1:B1',
    valueInputOption: 'RAW',
    requestBody: { values: [[newTopic, now]] },
  });
  // เคลียร์คะแนนเก่าเมื่อเปลี่ยนหัวข้อ
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: 'Votes!A2:E',
  });
}

async function appendVote({ ts, ip, ua, topic, choice }) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Votes!A:E',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[ts, ip, ua, topic, choice]] },
  });
}

async function countResult(topic) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Votes!A:E',
  });
  const rows = res.data.values || [];
  let yes = 0, no = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const rowTopic = (r[3] || '').trim();
    const choice = (r[4] || '').trim();
    if (rowTopic === topic) {
      if (choice === 'yes') yes++;
      if (choice === 'no')  no++;
    }
  }
  return { yes, no, total: yes + no };
}

function clientIp(req) {
  const h = req.headers || {};
  return (h['x-forwarded-for']?.split(',')[0]?.trim())
      || h['x-real-ip']
      || req.socket?.remoteAddress
      || '';
}

// -------------------------- routes --------------------------

// 1) แอดมินตั้งหัวข้อ (ต้องมีรหัส)
app.post('/topic', async (req, res) => {
  try {
    const pass = req.headers['x-admin-pass'] || req.body?.pass || '';
    if (!pass || pass !== ADMIN_PASS) {
      return res.status(403).json({ ok: false, error: 'bad-pass' });
    }
    const newTopic = (req.body?.topic || '').trim();
    if (!newTopic) return res.status(400).json({ ok: false, error: 'topic-required' });

    await setCurrentTopic(newTopic);
    const result = await countResult(newTopic);
    return res.json({ ok: true, topic: newTopic, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 2) ให้ทุกคนดึงหัวข้อปัจจุบันได้ (ใช้ตอนโหลดหน้า/รีเฟรช)
app.get('/poll', async (req, res) => {
  try {
    const { topic, updatedAt } = await getCurrentTopic();
    res.json({ ok: true, topic, updatedAt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 3) โหวต (ผู้ใช้ทั่วไป)
app.post('/vote', async (req, res) => {
  try {
    const choice = (req.body?.choice || '').trim(); // 'yes' | 'no'
    if (!['yes','no'].includes(choice)) {
      return res.status(400).json({ ok: false, error: 'bad-choice' });
    }
    const { topic } = await getCurrentTopic();
    if (!topic) return res.status(400).json({ ok: false, error: 'no-topic' });

    const ip = clientIp(req);
    const ua = req.headers['user-agent'] || '';
    const ts = new Date().toISOString();

    await appendVote({ ts, ip, ua, topic, choice });
    const result = await countResult(topic);
    res.json({ ok: true, topic, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 4) (ออปชัน) ดึงผลโหวต — เราเปิดไว้ใช้หลังโหวตเท่านั้นในหน้าเว็บ
app.get('/result', async (req, res) => {
  try {
    const { topic } = await getCurrentTopic();
    const result = await countResult(topic);
    res.json({ ok: true, topic, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// health
app.get('/', (req,res)=>res.send('ok'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=>console.log('listening on', PORT));
