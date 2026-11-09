const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function main() {
  const port = 9337;
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profileDir = 'C:\\Users\\Watislove\\AppData\\Local\\Temp\\chrome-cdp-capture-all';
  
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
    width: 1400,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  console.log('1. Capturing Admin Photo Filters...');
  await send('Page.navigate', { url: 'http://localhost:3030/admin.html' });
  await new Promise(r => setTimeout(r, 1500));

  // Log in as admin
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const form = document.getElementById('adminLoginForm');
        form.email.value = 'admin@modul-haus.ru';
        form.password.value = 'admin123';
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      })()
    `
  });
  await new Promise(r => setTimeout(r, 1200));

  // Switch to media tab
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-tab="media"]').click();`
  });
  await new Promise(r => setTimeout(r, 1000));

  const adminShot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\admin-photo-filters.png', Buffer.from(adminShot.data, 'base64'));
  console.log('Saved admin-photo-filters.png');

  console.log('2. Capturing Profile Dashboard in Light Theme...');
  await send('Page.navigate', { url: 'http://localhost:3030/profile.html' });
  await new Promise(r => setTimeout(r, 1000));

  // Register new client
  const phone = '+7 (999) ' + Math.floor(100 + Math.random() * 900) + '-' + Math.floor(10 + Math.random() * 90) + '-' + Math.floor(10 + Math.random() * 90);
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        document.getElementById('tabRegisterBtn').click();
        const form = document.getElementById('regStep1Form');
        form.name.value = 'Сергей Волков';
        form.phone.value = '${phone}';
        form.password.value = 'pass1234';
        form.passwordConfirm.value = 'pass1234';
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      })()
    `
  });
  await new Promise(r => setTimeout(r, 800));

  // Enter test code 1111
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        document.getElementById('regCodeInput').value = '1111';
        document.getElementById('regStep2Form').dispatchEvent(new Event('submit', { cancelable: true }));
      })()
    `
  });
  await new Promise(r => setTimeout(r, 3500)); // wait for toast to fade away

  const profileShot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\profile-light-clean.png', Buffer.from(profileShot.data, 'base64'));
  console.log('Saved profile-light-clean.png');

  console.log('3. Capturing Cart Drawer...');
  await send('Page.navigate', { url: 'http://localhost:3030/houses.html' });
  await new Promise(r => setTimeout(r, 1500));

  // Add to cart
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-hc-add-to-cart]').click();`
  });
  await new Promise(r => setTimeout(r, 3200)); // wait for toast to fade away

  const cartShot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\cart-drawer-clean.png', Buffer.from(cartShot.data, 'base64'));
  console.log('Saved cart-drawer-clean.png');

  ws.close();
  chrome.kill();
  console.log('All screenshots captured successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
