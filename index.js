// index.js
const express = require('express');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function clientIp(req) {
  const h = req.headers;
  return (
    h['x-forwarded-for']?.split(',')[0]?.trim() ||
    h['x-real-ip'] ||
    req.socket.remoteAddress
  );
}

app.post('/collector', (req, res) => {
  const ip = clientIp(req);
  const ua = req.headers['user-agent'];
  const now = new Date().toISOString();
  const record = { ts: now, ip, ua, data: req.body };
  fs.appendFileSync('log.jsonl', JSON.stringify(record) + '\n');
  res.status(204).end();
});

app.get('/', (req, res) => res.send('IP Collector is running.'));
const port = process.env.PORT || 8080;
app.listen(port, () => console.log('Listening on', port));
