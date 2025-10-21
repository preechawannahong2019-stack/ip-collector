const express = require("express");
const { google } = require("googleapis");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const SHEET_ID = process.env.SHEET_ID; // ตั้งค่าใน Cloud Run
const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

let currentTopic = "โหวตเรื่องใหม่กำลังรอแอดมินตั้งค่า";

app.get("/poll", (req, res) => {
  res.json({ topic: currentTopic });
});

// แอดมินเปลี่ยนหัวข้อโหวต (มีรหัส)
app.post("/topic", (req, res) => {
  const { topic, pin } = req.body;
  if (pin === "123") {
    currentTopic = topic || currentTopic;
    res.json({ message: "updated", topic: currentTopic });
  } else {
    res.status(403).json({ error: "invalid pin" });
  }
});

// โหวต
app.post("/vote", async (req, res) => {
  const { user, choice } = req.body;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0];
  const ua = req.headers["user-agent"];
  const ref = req.headers["referer"] || "";

  if (!choice) return res.status(400).json({ error: "missing choice" });

  const ts = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Sheet1!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[ts, user, currentTopic, choice, ip, ua, ref]],
      },
    });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Sheet1!A:F",
    });
    const values = result.data.values || [];
    const yes = values.filter(r => r[3] === "yes").length;
    const no = values.filter(r => r[3] === "no").length;

    res.json({ success: true, yes, no });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(8080, () => console.log("Server running on port 8080"));
