const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function main() {
  const port = 9334;
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profileDir = 'C:\\Users\\Watislove\\AppData\\Local\\Temp\\chrome-cdp-verify';
  
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

  // Set iPhone-like mobile viewport (375x812, 2x)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true
  });

  const pagesToTest = [
    { name: 'houses', url: 'http://localhost:3030/houses.html' },
    { name: 'saunas', url: 'http://localhost:3030/saunas.html' },
    { name: 'index', url: 'http://localhost:3030/' }
  ];

  for (const p of pagesToTest) {
    console.log(`\n================ Testing ${p.name} ================`);
    await send('Page.navigate', { url: p.url });
    await new Promise(r => setTimeout(r, 1500));

    // Check overflow
    const overflowRes = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const docWidth = document.documentElement.offsetWidth;
          const scrollWidth = document.documentElement.scrollWidth;
          const overflowing = [];
          document.querySelectorAll('*').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.right > docWidth + 1) {
              overflowing.push({
                tag: el.tagName,
                className: el.className,
                right: Math.round(rect.right),
                width: Math.round(rect.width)
              });
            }
          });
          return {
            docWidth,
            scrollWidth,
            hasHScroll: scrollWidth > docWidth,
            overflowCount: overflowing.length,
            overflowing: overflowing.slice(0, 5)
          };
        })()
      `,
      returnByValue: true
    });

    console.log(`Overflow check:`, overflowRes.result.result.value);

    // Verify checkout modal is NOT visible in page flow
    const modalCheck = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const modal = document.querySelector('[data-checkout-modal]');
          if (!modal) return { exists: false };
          const style = window.getComputedStyle(modal);
          return {
            exists: true,
            display: style.display,
            position: style.position,
            opacity: style.opacity,
            pointerEvents: style.pointerEvents,
            isOpen: modal.classList.contains('is-open')
          };
        })()
      `,
      returnByValue: true
    });
    console.log(`Checkout modal initial state (must be display:none or hidden):`, modalCheck.result.result.value);

    // Verify mobile burger menu opening & closing
    const burgerState = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = document.querySelector('[data-burger-btn]');
          const drawer = document.querySelector('[data-mobile-drawer]');
          if (!btn || !drawer) return { hasBurger: false };
          btn.click();
          const opened = drawer.classList.contains('is-open');
          const closeBtn = document.querySelector('[data-drawer-close]');
          if (closeBtn) closeBtn.click();
          const closed = !drawer.classList.contains('is-open');
          return { hasBurger: true, opened, closed };
        })()
      `,
      returnByValue: true
    });
    console.log(`Burger menu test:`, burgerState.result.result.value);

    // Take top screenshot
    const ssTop = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`C:\\Users\\Watislove\\AppData\\Local\\Temp\\verified-${p.name}-top.png`, Buffer.from(ssTop.result.data, 'base64'));

    if (p.name === 'houses') {
      // Test configurator color switch to Beige (must show placeholder slide!)
      console.log('Testing color switch to Beige in Houses configurator...');
      await send('Runtime.evaluate', {
        expression: `
          const beigeBtn = document.querySelector('[data-color="beige"]');
          if (beigeBtn) beigeBtn.click();
        `
      });
      await new Promise(r => setTimeout(r, 1000));

      const placeholderCheck = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const ph = document.querySelector('.hc-placeholder');
            const title = ph ? ph.querySelector('.hc-placeholder-title')?.textContent : null;
            const text = ph ? ph.querySelector('.hc-placeholder-text')?.textContent : null;
            const prevArrow = document.querySelector('[data-action="previous-slide"]');
            const nextArrow = document.querySelector('[data-action="next-slide"]');
            const prevHidden = prevArrow ? (prevArrow.hidden || window.getComputedStyle(prevArrow).display === 'none') : true;
            const nextHidden = nextArrow ? (nextArrow.hidden || window.getComputedStyle(nextArrow).display === 'none') : true;
            return {
              hasPlaceholder: !!ph,
              title,
              text,
              arrowsHidden: prevHidden && nextHidden
            };
          })()
        `,
        returnByValue: true
      });
      console.log('Beige placeholder slide check:', placeholderCheck.result.result.value);

      // Take screenshot of placeholder
      await send('Runtime.evaluate', {
        expression: `document.getElementById('configurator').scrollIntoView();`
      });
      await new Promise(r => setTimeout(r, 600));
      const ssPh = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`C:\\Users\\Watislove\\AppData\\Local\\Temp\\verified-houses-placeholder.png`, Buffer.from(ssPh.result.data, 'base64'));

      // Switch back to Bronze
      await send('Runtime.evaluate', {
        expression: `document.querySelector('[data-color="bronze"]').click();`
      });
      await new Promise(r => setTimeout(r, 1000));

      // Test Add to Cart button
      console.log('Testing "Добавить в корзину" button click...');
      await send('Runtime.evaluate', {
        expression: `document.querySelector('[data-hc-add-to-cart]').click();`
      });
      await new Promise(r => setTimeout(r, 600));

      const cartState = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const drawer = document.querySelector('[data-cart-overlay]');
            const isDrawerOpen = drawer ? drawer.classList.contains('is-open') : false;
            const items = Cart.getItems();
            const badge = document.querySelector('[data-cart-badge]')?.textContent;
            const renderedItems = document.querySelectorAll('.cart-item').length;
            const total = document.querySelector('[data-cart-total]')?.textContent;
            return {
              isDrawerOpen,
              cartItemsCount: items.length,
              badgeText: badge,
              renderedItems,
              totalText: total
            };
          })()
        `,
        returnByValue: true
      });
      console.log('Cart state after adding to cart:', cartState.result.result.value);

      // Take screenshot of opened cart drawer
      const ssCart = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`C:\\Users\\Watislove\\AppData\\Local\\Temp\\verified-cart-drawer.png`, Buffer.from(ssCart.result.data, 'base64'));

      // Test Click Checkout button inside Cart drawer
      console.log('Testing "Оформить заказ и оплатить" button inside drawer...');
      await send('Runtime.evaluate', {
        expression: `document.querySelector('[data-cart-checkout]').click();`
      });
      await new Promise(r => setTimeout(r, 600));

      const checkoutOpenState = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const modal = document.querySelector('[data-checkout-modal]');
            const isModalOpen = modal ? modal.classList.contains('is-open') : false;
            const summary = modal ? modal.querySelector('[data-checkout-summary]')?.textContent?.trim() : null;
            return {
              isModalOpen,
              summary
            };
          })()
        `,
        returnByValue: true
      });
      console.log('Checkout modal state after drawer checkout click:', checkoutOpenState.result.result.value);

      // Take screenshot of opened checkout modal
      const ssCheckout = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`C:\\Users\\Watislove\\AppData\\Local\\Temp\\verified-checkout-modal.png`, Buffer.from(ssCheckout.result.data, 'base64'));

      // Close checkout modal
      await send('Runtime.evaluate', {
        expression: `document.querySelector('[data-checkout-close]').click();`
      });
      await new Promise(r => setTimeout(r, 400));
    }
  }

  ws.close();
  chrome.kill();
  console.log('\n✅ All browser verifications completed successfully!');
}

main().catch(console.error);
