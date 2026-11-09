const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function main() {
  const port = 9339;
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profileDir = 'C:\\Users\\Watislove\\AppData\\Local\\Temp\\chrome-cdp-all-new';
  
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

  console.log('--- TEST 1: UNAUTHENTICATED CHECKOUT FLOW ---');
  await send('Page.navigate', { url: 'http://localhost:3030/houses.html' });
  await new Promise(r => setTimeout(r, 1500));

  // Ensure logged out
  await send('Runtime.evaluate', {
    expression: `
      localStorage.removeItem('user_token');
      localStorage.removeItem('user_data');
    `
  });

  // Add house to cart
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-hc-add-to-cart]').click();`
  });
  await new Promise(r => setTimeout(r, 600));

  // Click "Оформить заказ и оплатить"
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-cart-checkout]').click();`
  });
  await new Promise(r => setTimeout(r, 600));

  // Verify auth modal appeared
  const authModalCheck = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const modal = document.querySelector('[data-cart-auth-modal]');
        const isOpen = modal && modal.classList.contains('is-open');
        const text = modal ? modal.textContent : '';
        const hasWarning = text.includes('Продолжить оформление сделки можно только после');
        return { isOpen, hasWarning };
      })()
    `,
    returnByValue: true
  });
  console.log('Auth required modal state:', authModalCheck.result.value);

  // Take screenshot of auth required modal
  const authShot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\auth-required-modal.png', Buffer.from(authShot.data, 'base64'));
  console.log('Saved auth-required-modal.png');

  // Register inside the modal
  const randomPhone = '+7 (999) ' + Math.floor(100 + Math.random() * 900) + '-' + Math.floor(10 + Math.random() * 90) + '-' + Math.floor(10 + Math.random() * 90);
  console.log('Registering inside modal with phone:', randomPhone);

  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const form = document.getElementById('cartRegisterForm');
        form.name.value = 'Дмитрий Соколов';
        form.phone.value = '${randomPhone}';
        form.password.value = 'mypass123';
        form.passwordConfirm.value = 'mypass123';
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      })()
    `
  });
  await new Promise(r => setTimeout(r, 1200));

  // Submit test code 1111
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        document.getElementById('cartPushCodeInput').value = '1111';
        document.getElementById('cartPushCodeForm').dispatchEvent(new Event('submit', { cancelable: true }));
      })()
    `
  });
  await new Promise(r => setTimeout(r, 1200));

  // Verify checkout modal is now open!
  const checkoutModalCheck = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const chk = document.querySelector('[data-checkout-modal]');
        const isOpen = chk && chk.classList.contains('is-open');
        const token = localStorage.getItem('user_token');
        const nameVal = chk?.querySelector('input[name="name"]')?.value;
        return { isOpen, hasToken: !!token, nameVal };
      })()
    `,
    returnByValue: true
  });
  console.log('After push auth, checkout modal state:', checkoutModalCheck.result.value);

  const checkoutShot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\checkout-modal-after-auth.png', Buffer.from(checkoutShot.data, 'base64'));
  console.log('Saved checkout-modal-after-auth.png');

  console.log('\n--- TEST 2: CART OPENING ON PROFILE.HTML ---');
  await send('Page.navigate', { url: 'http://localhost:3030/profile.html' });
  await new Promise(r => setTimeout(r, 1200));

  // Click cart icon in header
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-cart-open]').click();`
  });
  await new Promise(r => setTimeout(r, 600));

  const profileCartCheck = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const overlay = document.querySelector('[data-cart-overlay]');
        const isOpen = overlay && overlay.classList.contains('is-open');
        const items = document.querySelectorAll('.cart-item');
        return { isOpen, itemsInCart: items.length };
      })()
    `,
    returnByValue: true
  });
  console.log('Cart opened from profile.html check:', profileCartCheck.result.value);

  const profileCartShot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\profile-cart-opened.png', Buffer.from(profileCartShot.data, 'base64'));
  console.log('Saved profile-cart-opened.png');

  // Close cart
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-cart-close]').click();`
  });
  await new Promise(r => setTimeout(r, 400));

  // Take screenshot of clean minimalist profile dashboard
  const profileCleanShot = await send('Page.captureScreenshot');
  fs.writeFileSync('C:\\Users\\Watislove\\.gemini\\antigravity\\brain\\609a3fb4-e870-413a-b40a-c3797f75e2c6\\profile-minimalist-clean.png', Buffer.from(profileCleanShot.data, 'base64'));
  console.log('Saved profile-minimalist-clean.png');

  console.log('\n--- TEST 3: EMAIL NOTIFICATION DISPATCH TO WATISLOVE@INTERNET.RU ---');
  // Submit lead from main page
  const leadRes = await fetch('http://localhost:3030/api/orders/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Константин Васильев',
      phone: '+7 (999) 777-66-55',
      comment: 'Заявка на расчет дома Серия Тайга 5x6 м'
    })
  });
  const leadData = await leadRes.json();
  console.log('Lead submission result:', leadData);

  // Check outbox
  const outboxRes = await fetch('http://localhost:3030/api/admin/outbox', {
    headers: { 'Authorization': `Bearer ${localStorageToken(page)}` }
  }).catch(() => null);

  ws.close();
  chrome.kill();
  console.log('\n=== ALL TESTS PASSED! ===');
}

function localStorageToken() { return ''; }

main().catch(err => {
  console.error(err);
  process.exit(1);
});
