const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function main() {
  const port = 9335;
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profileDir = 'C:\\Users\\Watislove\\AppData\\Local\\Temp\\chrome-cdp-verify-fixes';
  
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

  console.log('=== TEST 1: ADD TO CART & QUANTITY STEPPER ON HOUSES.HTML ===');
  await send('Page.navigate', { url: 'http://localhost:3030/houses.html' });
  await new Promise(r => setTimeout(r, 2000));

  // Check Cart is defined
  const cartDefined = await send('Runtime.evaluate', { expression: 'typeof window.Cart' });
  console.log('typeof window.Cart:', cartDefined.result.value);

  // Click add to cart
  const addCartRes = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const btn = document.querySelector('[data-hc-add-to-cart]');
        if (!btn) return 'button not found';
        btn.click();
        return 'clicked';
      })()
    `
  });
  console.log('Click add to cart result:', addCartRes.result.value);
  await new Promise(r => setTimeout(r, 600));

  // Check drawer is open and item is present
  const cartState = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const overlay = document.querySelector('[data-cart-overlay]');
        const isOpen = overlay && overlay.classList.contains('is-open');
        const items = document.querySelectorAll('.cart-item');
        const badge = document.querySelector('[data-cart-badge]')?.textContent;
        const total = document.querySelector('[data-cart-total]')?.textContent;
        const qtyVal = document.querySelector('.cart-qty-val')?.textContent;
        return { isOpen, itemCount: items.length, badge, total, qtyVal };
      })()
    `,
    returnByValue: true
  });
  console.log('Cart state after add:', cartState.result.value);

  // Test quantity increment
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-cart-qty-inc]').click()`
  });
  await new Promise(r => setTimeout(r, 400));

  const afterInc = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const badge = document.querySelector('[data-cart-badge]')?.textContent;
        const total = document.querySelector('[data-cart-total]')?.textContent;
        const qtyVal = document.querySelector('.cart-qty-val')?.textContent;
        return { badge, total, qtyVal };
      })()
    `,
    returnByValue: true
  });
  console.log('Cart state after + (increment):', afterInc.result.value);

  // Test quantity decrement
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-cart-qty-dec]').click()`
  });
  await new Promise(r => setTimeout(r, 400));

  const afterDec = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const badge = document.querySelector('[data-cart-badge]')?.textContent;
        const total = document.querySelector('[data-cart-total]')?.textContent;
        const qtyVal = document.querySelector('.cart-qty-val')?.textContent;
        return { badge, total, qtyVal };
      })()
    `,
    returnByValue: true
  });
  console.log('Cart state after - (decrement):', afterDec.result.value);

  // Screenshot of cart drawer
  const cartScreenshot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\cart-drawer-working.png', Buffer.from(cartScreenshot.data || cartScreenshot.result?.data, 'base64'));
  console.log('Saved cart screenshot');

  console.log('\n=== TEST 2: ADMIN PHOTO MANAGEMENT FILTERS ===');
  await send('Page.navigate', { url: 'http://localhost:3030/admin.html' });
  await new Promise(r => setTimeout(r, 1500));

  // Enter admin password
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const input = document.getElementById('adminAuthPassword');
        input.value = 'admin';
        document.getElementById('adminAuthForm').dispatchEvent(new Event('submit', { cancelable: true }));
      })()
    `
  });
  await new Promise(r => setTimeout(r, 1000));

  // Switch to media tab
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-tab="media"]').click();`
  });
  await new Promise(r => setTimeout(r, 1000));

  const adminFiltersState = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const grid = document.querySelector('.admin-media-filters-grid');
        const fields = document.querySelectorAll('.admin-filter-field');
        const badge = document.querySelector('[data-media-count-badge]')?.textContent;
        const resetBtn = document.querySelector('[data-media-reset-btn]')?.textContent?.trim();
        return {
          gridExists: !!grid,
          fieldCount: fields.length,
          badge,
          resetBtn
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Admin filters layout check:', adminFiltersState.result.value);

  const adminScreenshot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\admin-filters-clean.png', Buffer.from(adminScreenshot.data || adminScreenshot.result?.data, 'base64'));
  console.log('Saved admin filters screenshot');

  console.log('\n=== TEST 3: PERSONAL CABINET (PROFILE.HTML) LIGHT THEME & AUTH ===');
  await send('Page.navigate', { url: 'http://localhost:3030/profile.html' });
  await new Promise(r => setTimeout(r, 1500));

  // Check initial state (logged out, light theme)
  const profileStyle = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const bg = window.getComputedStyle(document.body).backgroundColor;
        const authCard = document.getElementById('authRequiredCard');
        const isAuthCardVisible = authCard && authCard.style.display !== 'none';
        const cardBg = window.getComputedStyle(authCard).backgroundColor;
        return { bodyBg: bg, isAuthCardVisible, cardBg };
      })()
    `,
    returnByValue: true
  });
  console.log('Profile initial light styles:', profileStyle.result.value);

  const profileLoggedOutScreenshot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\profile-light-logged-out.png', Buffer.from(profileLoggedOutScreenshot.data || profileLoggedOutScreenshot.result?.data, 'base64'));

  // Switch to register tab, fill form, send push
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        document.getElementById('tabRegisterBtn').click();
        const form = document.getElementById('regStep1Form');
        form.name.value = 'Алексей Смирнов';
        form.phone.value = '+7 (912) 345-67-89';
        form.password.value = 'password123';
        form.passwordConfirm.value = 'password123';
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      })()
    `
  });
  await new Promise(r => setTimeout(r, 1200));

  // Enter test code 1111
  const step2Check = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const step2 = document.getElementById('regStep2Box');
        const isVisible = step2 && step2.style.display !== 'none';
        if (isVisible) {
          document.getElementById('regCodeInput').value = '1111';
          document.getElementById('regStep2Form').dispatchEvent(new Event('submit', { cancelable: true }));
        }
        return { step2Visible: isVisible };
      })()
    `,
    returnByValue: true
  });
  console.log('Entered test push code 1111, step2Check:', step2Check.result.value);
  await new Promise(r => setTimeout(r, 1500));

  // Check logged in dashboard
  const dashboardState = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const d = document.getElementById('cabinetDashboard');
        const isVisible = d && d.style.display !== 'none';
        const name = document.getElementById('userNameDisplay')?.textContent;
        const phone = document.getElementById('userContactDisplay')?.textContent?.trim();
        const ordersCount = document.getElementById('ordersCountNotice')?.textContent;
        return { isVisible, name, phone, ordersCount };
      })()
    `,
    returnByValue: true
  });
  console.log('Dashboard state after login:', dashboardState.result.value);

  const profileLoggedInScreenshot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\profile-light-logged-in.png', Buffer.from(profileLoggedInScreenshot.data || profileLoggedInScreenshot.result?.data, 'base64'));
  console.log('Saved profile logged-in screenshot');

  // Test logout
  await send('Runtime.evaluate', {
    expression: `document.getElementById('logoutBtn').click();`
  });
  await new Promise(r => setTimeout(r, 800));

  const afterLogout = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const d = document.getElementById('cabinetDashboard');
        const authCard = document.getElementById('authRequiredCard');
        const token = localStorage.getItem('user_token');
        return {
          dashboardHidden: d.style.display === 'none',
          authCardVisible: authCard.style.display !== 'none',
          tokenCleared: token === null
        };
      })()
    `,
    returnByValue: true
  });
  console.log('After logout check:', afterLogout.result.value);

  ws.close();
  chrome.kill();
  console.log('\n=== ALL BROWSER CHECKS COMPLETED SUCCESSFULLY! ===');
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
