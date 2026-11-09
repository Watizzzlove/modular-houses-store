const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function main() {
  const port = 9336;
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profileDir = 'C:\\Users\\Watislove\\AppData\\Local\\Temp\\chrome-cdp-profile-test';
  
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
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  console.log('Navigating to profile.html...');
  await send('Page.navigate', { url: 'http://localhost:3030/profile.html' });
  await new Promise(r => setTimeout(r, 1500));

  // Test registration with a unique new phone number
  const uniquePhone = '+7 (999) ' + Math.floor(100 + Math.random() * 900) + '-' + Math.floor(10 + Math.random() * 90) + '-' + Math.floor(10 + Math.random() * 90);
  console.log('Testing fresh registration with phone:', uniquePhone);

  await send('Runtime.evaluate', {
    expression: `
      (() => {
        document.getElementById('tabRegisterBtn').click();
        const form = document.getElementById('regStep1Form');
        form.name.value = 'Владислав Тестов';
        form.phone.value = '${uniquePhone}';
        form.password.value = 'secret123';
        form.passwordConfirm.value = 'secret123';
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      })()
    `
  });
  await new Promise(r => setTimeout(r, 1000));

  // Verify step 2 appears and enter test code 1111
  const step2Info = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const step2 = document.getElementById('regStep2Box');
        const isVisible = step2 && step2.style.display !== 'none';
        const notice = document.getElementById('sentPhoneNotice')?.textContent;
        if (isVisible) {
          document.getElementById('regCodeInput').value = '1111';
          document.getElementById('regStep2Form').dispatchEvent(new Event('submit', { cancelable: true }));
        }
        return { isVisible, notice };
      })()
    `,
    returnByValue: true
  });
  console.log('Push step 2 state:', step2Info.result.value);
  await new Promise(r => setTimeout(r, 1500));

  // Verify dashboard is shown
  const dashboardState = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const d = document.getElementById('cabinetDashboard');
        const isVisible = d && d.style.display !== 'none';
        const name = document.getElementById('userNameDisplay')?.textContent;
        const phone = document.getElementById('userContactDisplay')?.textContent?.trim();
        const navName = document.querySelector('[data-user-nav-name]')?.textContent;
        return { isVisible, name, phone, navName };
      })()
    `,
    returnByValue: true
  });
  console.log('Dashboard after push registration:', dashboardState.result.value);

  // Take screenshot of fresh logged-in dashboard
  const dashScreenshot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\profile-fresh-dashboard.png', Buffer.from(dashScreenshot.data || dashScreenshot.result?.data, 'base64'));
  console.log('Saved profile-fresh-dashboard.png');

  // Now test logout
  await send('Runtime.evaluate', {
    expression: `document.getElementById('logoutBtn').click();`
  });
  await new Promise(r => setTimeout(r, 600));

  const logoutResult = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const authCard = document.getElementById('authRequiredCard');
        const dash = document.getElementById('cabinetDashboard');
        const token = localStorage.getItem('user_token');
        const navName = document.querySelector('[data-user-nav-name]')?.textContent;
        return {
          authCardVisible: authCard.style.display !== 'none',
          dashHidden: dash.style.display === 'none',
          tokenIsNull: token === null,
          navNameReset: navName === 'Кабинет'
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Logout result:', logoutResult.result.value);

  ws.close();
  chrome.kill();
  console.log('Done!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
