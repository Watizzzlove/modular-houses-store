const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function main() {
  const port = 9338;
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profileDir = 'C:\\Users\\Watislove\\AppData\\Local\\Temp\\chrome-visual-inspect';

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank'
  ]);

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
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
  };

  await new Promise(r => ws.onopen = r);

  function send(method, params = {}) {
    return new Promise(resolve => {
      const msgId = id++;
      callbacks.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  await send('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true
  });

  async function snap(name) {
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`C:\\Users\\Watislove\\AppData\\Local\\Temp\\v-${name}.png`, Buffer.from(ss.result.data, 'base64'));
    console.log(`Captured v-${name}.png`);
  }

  // 1. Inspect houses.html configurator panel
  await send('Page.navigate', { url: 'http://localhost:3030/houses.html' });
  await new Promise(r => setTimeout(r, 1500));

  await send('Runtime.evaluate', {
    expression: `document.querySelector('.hc-panel').scrollIntoView();`
  });
  await new Promise(r => setTimeout(r, 500));
  await snap('houses-panel');

  // Scroll to summary & add to cart
  await send('Runtime.evaluate', {
    expression: `document.querySelector('.hc-summary-card').scrollIntoView();`
  });
  await new Promise(r => setTimeout(r, 500));
  await snap('houses-summary');

  // Scroll to lead banner
  await send('Runtime.evaluate', {
    expression: `document.querySelector('.lead-banner-section').scrollIntoView();`
  });
  await new Promise(r => setTimeout(r, 500));
  await snap('houses-lead');

  // Click burger menu to see drawer
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-burger-btn]').click();`
  });
  await new Promise(r => setTimeout(r, 500));
  await snap('mobile-nav-drawer');

  // Close nav drawer
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-drawer-close]').click();`
  });
  await new Promise(r => setTimeout(r, 300));

  // Open empty cart drawer
  await send('Runtime.evaluate', {
    expression: `Cart.clear(); Cart.openDrawer();`
  });
  await new Promise(r => setTimeout(r, 500));
  await snap('cart-empty');

  // Close cart
  await send('Runtime.evaluate', {
    expression: `Cart.closeDrawer();`
  });
  await new Promise(r => setTimeout(r, 300));

  // Inspect index.html popular projects
  await send('Page.navigate', { url: 'http://localhost:3030/' });
  await new Promise(r => setTimeout(r, 1500));
  await send('Runtime.evaluate', {
    expression: `document.getElementById('categories').scrollIntoView();`
  });
  await new Promise(r => setTimeout(r, 500));
  await snap('index-categories');

  await send('Runtime.evaluate', {
    expression: `document.getElementById('stats').scrollIntoView();`
  });
  await new Promise(r => setTimeout(r, 500));
  await snap('index-stats');

  await send('Runtime.evaluate', {
    expression: `document.getElementById('projects').scrollIntoView();`
  });
  await new Promise(r => setTimeout(r, 500));
  await snap('index-projects');

  ws.close();
  chrome.kill();
  console.log('Done visual inspection!');
}

main().catch(console.error);
