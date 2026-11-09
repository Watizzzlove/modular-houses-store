const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function main() {
  const port = 9338;
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profileDir = 'C:\\Users\\Watislove\\AppData\\Local\\Temp\\chrome-cdp-admin-shot';
  
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank'
  ]);

  // Wait for CDP
  await new Promise((resolve, reject) => {
    let retries = 0;
    const interval = setInterval(() => {
      http.get(`http://127.0.0.1:${port}/json/version`, res => {
        if (res.statusCode === 200) {
          clearInterval(interval);
          resolve();
        }
      }).on('error', () => {
        if (++retries > 30) {
          clearInterval(interval);
          reject(new Error('Failed to connect to Chrome CDP'));
        }
      });
    }, 200);
  });

  const list = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/list`, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let id = 1;
  const callbacks = new Map();
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && callbacks.has(data.id)) {
      const cb = callbacks.get(data.id);
      callbacks.delete(data.id);
      cb(data.result || {});
    }
  };

  const send = (method, params = {}) => new Promise((resolve) => {
    const msgId = id++;
    callbacks.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  await new Promise(r => ws.onopen = r);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1300,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  console.log('Navigating to admin.html...');
  await send('Page.navigate', { url: 'http://localhost:3030/admin.html' });
  await new Promise(r => setTimeout(r, 1200));

  // Click login submit
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const btn = document.querySelector('[data-login-form] button[type="submit"]');
        if (btn) btn.click();
      })()
    `
  });
  await new Promise(r => setTimeout(r, 1200));

  // Click media tab
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const tab = document.querySelector('[data-tab="media"]');
        if (tab) tab.click();
      })()
    `
  });
  await new Promise(r => setTimeout(r, 1200));

  const adminShot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\admin-photo-filters-clean.png', Buffer.from(adminShot.data, 'base64'));
  console.log('Saved admin-photo-filters-clean.png');

  ws.close();
  chrome.kill();
}

main().catch(console.error);
