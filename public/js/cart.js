// Cart & Payment Management for Dokabani Store
const Cart = (function () {
  const STORAGE_KEY = 'doka_cart';

  function getItems() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveItems(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    updateBadges();
    renderDrawer();
  }

  function addItem(item) {
    const items = getItems();
    // Check if exact item already in cart
    const existingIndex = items.findIndex(i =>
      i.title === item.title &&
      JSON.stringify(i.details || {}) === JSON.stringify(item.details || {})
    );

    if (existingIndex !== -1) {
      items[existingIndex].quantity = (items[existingIndex].quantity || 1) + 1;
    } else {
      items.push({
        ...item,
        quantity: 1,
        addedAt: Date.now()
      });
    }

    saveItems(items);
    showToast(`«${item.title}» добавлен в корзину`);
  }

  function removeItem(index) {
    const items = getItems();
    if (index >= 0 && index < items.length) {
      items.splice(index, 1);
      saveItems(items);
      showToast('Товар удален из корзины');
    }
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
    updateBadges();
    renderDrawer();
  }

  function getTotalPrice() {
    return getItems().reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1), 0);
  }

  function formatPrice(val) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(val) || 0) + ' ₽';
  }

  function updateBadges() {
    const items = getItems();
    const count = items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
    const badges = document.querySelectorAll('[data-cart-badge]');
    badges.forEach(b => {
      b.textContent = count;
      b.style.display = count > 0 ? 'inline-grid' : 'none';
    });
  }

  function openDrawer() {
    const overlay = document.querySelector('[data-cart-overlay]');
    if (overlay) {
      renderDrawer();
      overlay.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeDrawer() {
    const overlay = document.querySelector('[data-cart-overlay]');
    if (overlay) {
      overlay.classList.remove('is-open');
      document.body.style.overflow = '';
    }
  }

  function renderDrawer() {
    const itemsContainer = document.querySelector('[data-cart-items]') || document.querySelector('[data-cart-items-container]');
    const totalEl = document.querySelector('[data-cart-total]');
    const emptyEl = document.querySelector('[data-cart-empty]');
    const footerEl = document.querySelector('[data-cart-footer]');
    if (!itemsContainer) return;

    const items = getItems();
    if (items.length === 0) {
      if (emptyEl) {
        emptyEl.style.display = 'block';
        itemsContainer.innerHTML = '';
      } else {
        itemsContainer.innerHTML = `
          <div class="cart-empty-state" data-cart-empty>
            <div class="cart-empty-icon" aria-hidden="true">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <path d="M16 10a4 4 0 0 1-8 0"></path>
              </svg>
            </div>
            <div class="cart-empty-title">Ваша корзина пуста</div>
            <p class="cart-empty-sub">Выберите понравившийся проект в каталоге или настройте его в конструкторе</p>
          </div>
        `;
      }
      if (footerEl) footerEl.style.display = 'none';
      if (totalEl) totalEl.textContent = '0 ₽';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (footerEl) footerEl.style.display = 'block';

    itemsContainer.innerHTML = items.map((item, idx) => {
      const detailsList = item.details ? Object.entries(item.details).map(([k, v]) => `${k}: ${v}`).join(' • ') : '';
      const thumb = item.image || '/houses/altai/9x9.5__p4259000/bronze/main.jpg';
      return `
        <div class="cart-item">
          <img src="${thumb}" alt="${item.title}" class="cart-item-thumb">
          <div>
            <h4 class="cart-item-title">${item.title}</h4>
            <div class="cart-item-desc">${detailsList}</div>
            <div class="cart-item-price">${formatPrice(item.price)} × ${item.quantity || 1}</div>
          </div>
          <button class="cart-item-remove" type="button" data-cart-remove="${idx}" title="Удалить">✕</button>
        </div>
      `;
    }).join('');

    if (totalEl) {
      totalEl.textContent = formatPrice(getTotalPrice());
    }
  }

  // Phone regex check
  const PHONE_REGEX = /^(\+7|7|8)?[\s\-]?\(?[489][0-9]{2}\)?[\s\-]?[0-9]{3}[\s\-]?[0-9]{2}[\s\-]?[0-9]{2}$/;

  function isValidPhone(p) {
    if (!p) return false;
    const clean = String(p).trim();
    const digits = clean.replace(/\D/g, '');
    return PHONE_REGEX.test(clean) && (digits.length === 10 || digits.length === 11);
  }

  function applyPhoneMask(input) {
    if (!input) return;
    input.addEventListener('input', function() {
      let v = this.value.replace(/\D/g, '');
      if (v.startsWith('7') || v.startsWith('8')) v = v.substring(1);
      v = v.substring(0, 10);
      let formatted = '+7 ';
      if (v.length > 0) formatted += '(' + v.substring(0, 3);
      if (v.length >= 3) formatted += ') ' + v.substring(3, 6);
      if (v.length >= 6) formatted += '-' + v.substring(6, 8);
      if (v.length >= 8) formatted += '-' + v.substring(8, 10);
      this.value = formatted;
    });
  }

  function openAuthRequiredModal() {
    closeDrawer();
    let authModal = document.querySelector('[data-cart-auth-modal]');
    if (!authModal) {
      authModal = document.createElement('div');
      authModal.className = 'cart-checkout-modal';
      authModal.setAttribute('data-cart-auth-modal', '');
      authModal.innerHTML = `
        <div class="cart-checkout-card" style="max-width: 460px;">
          <div class="cart-checkout-head">
            <h3 style="margin: 0; font-size: 20px;">Оформление заказа</h3>
            <button type="button" class="checkout-close-btn" data-close-auth-modal aria-label="Закрыть">&times;</button>
          </div>

          <div style="background: #fff9e6; border: 1px solid #ffe399; border-radius: 14px; padding: 14px 18px; margin-bottom: 20px; font-size: 13px; color: #7a5400; line-height: 1.45;">
            <strong>Зарегистрируйтесь или войдите</strong>, чтобы продолжить оформление заказа. В личном кабинете вы сможете отслеживать этапы производства дома, доставку и статус оплаты.
          </div>

          <div style="display: flex; gap: 8px; margin-bottom: 18px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
            <button type="button" id="cartAuthTabReg" style="background: #1c1d1f; color: #fff; border: none; border-radius: 8px; padding: 8px 16px; font-weight: 700; font-size: 13px; cursor: pointer;">
              Регистрация
            </button>
            <button type="button" id="cartAuthTabLogin" style="background: none; color: #666; border: none; border-radius: 8px; padding: 8px 16px; font-weight: 700; font-size: 13px; cursor: pointer;">
              Вход
            </button>
          </div>

          <!-- REGISTER FORM -->
          <form id="cartRegisterForm">
            <div class="form-group" style="margin-bottom: 12px;">
              <label style="font-size: 12px; font-weight: 700; display: block; margin-bottom: 4px;">Ваше имя</label>
              <input type="text" name="name" class="lead-input-pill" style="width: 100%; box-sizing: border-box; border: 1px solid #dcdad4; padding: 10px 14px; border-radius: 10px;" placeholder="Иван Иванов" required>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
              <label style="font-size: 12px; font-weight: 700; display: block; margin-bottom: 4px;">Номер телефона</label>
              <input type="tel" name="phone" id="cartRegPhoneInput" class="lead-input-pill" style="width: 100%; box-sizing: border-box; border: 1px solid #dcdad4; padding: 10px 14px; border-radius: 10px;" placeholder="+7 (999) 000-00-00" required>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
              <label style="font-size: 12px; font-weight: 700; display: block; margin-bottom: 4px;">Email (необязательно)</label>
              <input type="email" name="email" class="lead-input-pill" style="width: 100%; box-sizing: border-box; border: 1px solid #dcdad4; padding: 10px 14px; border-radius: 10px;" placeholder="mail@example.com">
            </div>
            <div class="form-group" style="margin-bottom: 18px;">
              <label style="font-size: 12px; font-weight: 700; display: block; margin-bottom: 4px;">Пароль для личного кабинета</label>
              <input type="password" name="password" class="lead-input-pill" style="width: 100%; box-sizing: border-box; border: 1px solid #dcdad4; padding: 10px 14px; border-radius: 10px;" placeholder="Минимум 6 символов" minlength="6" required>
            </div>
            <button type="submit" class="btn-hero-orange" style="width: 100%; padding: 12px; font-size: 15px;">
              Зарегистрироваться и продолжить
            </button>
          </form>

          <!-- LOGIN FORM -->
          <form id="cartLoginForm" style="display: none;">
            <div class="form-group" style="margin-bottom: 12px;">
              <label style="font-size: 12px; font-weight: 700; display: block; margin-bottom: 4px;">Телефон или Email</label>
              <input type="text" name="login" class="lead-input-pill" style="width: 100%; box-sizing: border-box; border: 1px solid #dcdad4; padding: 10px 14px; border-radius: 10px;" placeholder="+7 (999) 000-00-00 или email" required>
            </div>
            <div class="form-group" style="margin-bottom: 18px;">
              <label style="font-size: 12px; font-weight: 700; display: block; margin-bottom: 4px;">Пароль</label>
              <input type="password" name="password" class="lead-input-pill" style="width: 100%; box-sizing: border-box; border: 1px solid #dcdad4; padding: 10px 14px; border-radius: 10px;" placeholder="••••••••" required>
            </div>
            <button type="submit" class="btn-hero-orange" style="width: 100%; padding: 12px; font-size: 15px;">
              Войти и продолжить заказ
            </button>
          </form>
        </div>
      `;
      document.body.appendChild(authModal);

      // Bind close
      authModal.querySelector('[data-close-auth-modal]').addEventListener('click', () => {
        authModal.classList.remove('is-open');
        document.body.style.overflow = '';
      });

      // Bind tabs
      const tabReg = authModal.querySelector('#cartAuthTabReg');
      const tabLogin = authModal.querySelector('#cartAuthTabLogin');
      const regForm = authModal.querySelector('#cartRegisterForm');
      const loginForm = authModal.querySelector('#cartLoginForm');

      tabReg.addEventListener('click', () => {
        tabReg.style.background = '#1c1d1f'; tabReg.style.color = '#fff';
        tabLogin.style.background = 'none'; tabLogin.style.color = '#666';
        regForm.style.display = 'block'; loginForm.style.display = 'none';
      });

      tabLogin.addEventListener('click', () => {
        tabLogin.style.background = '#1c1d1f'; tabLogin.style.color = '#fff';
        tabReg.style.background = 'none'; tabReg.style.color = '#666';
        loginForm.style.display = 'block'; regForm.style.display = 'none';
      });

      applyPhoneMask(authModal.querySelector('#cartRegPhoneInput'));

      // Register submit
      regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = regForm.querySelector('button');
        btn.disabled = true;
        btn.textContent = 'Регистрация...';

        try {
          const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: regForm.name.value,
              phone: regForm.phone.value,
              email: regForm.email.value,
              password: regForm.password.value
            })
          });
          const data = await res.json();
          if (res.ok && data.token) {
            localStorage.setItem('user_token', data.token);
            localStorage.setItem('user_data', JSON.stringify(data.user));
            authModal.classList.remove('is-open');
            openCheckoutModal();
          } else {
            alert(data.error || 'Ошибка при регистрации');
            btn.disabled = false;
            btn.textContent = 'Зарегистрироваться и продолжить';
          }
        } catch (err) {
          alert('Ошибка связи с сервером');
          btn.disabled = false;
          btn.textContent = 'Зарегистрироваться и продолжить';
        }
      });

      // Login submit
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = loginForm.querySelector('button');
        btn.disabled = true;
        btn.textContent = 'Вход...';

        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              login: loginForm.login.value,
              password: loginForm.password.value
            })
          });
          const data = await res.json();
          if (res.ok && data.token) {
            localStorage.setItem('user_token', data.token);
            localStorage.setItem('user_data', JSON.stringify(data.user));
            authModal.classList.remove('is-open');
            openCheckoutModal();
          } else {
            alert(data.error || 'Ошибка входа');
            btn.disabled = false;
            btn.textContent = 'Войти и продолжить заказ';
          }
        } catch (err) {
          alert('Ошибка связи с сервером');
          btn.disabled = false;
          btn.textContent = 'Войти и продолжить заказ';
        }
      });
    }

    authModal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function openCheckoutModal() {
    closeDrawer();
    const modal = document.querySelector('[data-checkout-modal]');
    if (!modal) return;

    // Pre-fill user data if authenticated
    try {
      const stored = localStorage.getItem('user_data');
      if (stored) {
        const u = JSON.parse(stored);
        const nameInp = modal.querySelector('input[name="name"]');
        const phoneInp = modal.querySelector('input[name="phone"]');
        const emailInp = modal.querySelector('input[name="email"]');
        if (nameInp && u.name) nameInp.value = u.name;
        if (phoneInp && u.phone) phoneInp.value = u.phone;
        if (emailInp && u.email && !u.email.includes('@modul-client.local')) emailInp.value = u.email;
      }
    } catch (e) {}

    const phoneInp = modal.querySelector('input[name="phone"]');
    if (phoneInp) applyPhoneMask(phoneInp);

    const summaryEl = modal.querySelector('[data-checkout-summary]');
    if (summaryEl) {
      const items = getItems();
      const count = items.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);
      summaryEl.innerHTML = `
        <div class="checkout-summary-box">
          <span>Товаров в заказе: <strong>${count} шт.</strong></span>
          <span class="checkout-summary-price">Итого: <strong>${formatPrice(getTotalPrice())}</strong></span>
        </div>
      `;
    }

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeCheckoutModal() {
    const modal = document.querySelector('[data-checkout-modal]');
    if (modal) {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
  }

  async function handleCheckout(formEl) {
    const items = getItems();
    if (items.length === 0) {
      showToast('Корзина пуста');
      return;
    }

    const formData = new FormData(formEl);
    const customerPhone = formData.get('phone');
    if (!isValidPhone(customerPhone)) {
      alert('Пожалуйста, введите корректный номер телефона РФ (например, +7 999 123-45-67)');
      return;
    }

    const payload = {
      customerName: formData.get('name'),
      customerPhone: customerPhone,
      customerEmail: formData.get('email'),
      customerAddress: formData.get('address'),
      customerComment: formData.get('comment'),
      items
    };

    const submitBtn = formEl.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Оформление...';
    }

    try {
      const token = localStorage.getItem('user_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // 1. Create order
      const createRes = await fetch('/api/orders', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      const orderData = await createRes.json();
      if (!createRes.ok) throw new Error(orderData.error || 'Ошибка создания заказа');

      closeCheckoutModal();
      clear();

      // Redirect to test payment gateway
      const paymentUrl = orderData.paymentUrl || `/payment.html?orderId=${orderData.orderId}`;
      window.location.href = paymentUrl;
    } catch (err) {
      alert('Ошибка: ' + err.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }
  }

  function showPaymentModal(orderId, orderNumber, amount) {
    closeDrawer();
    closeCheckoutModal();
    let modal = document.querySelector('[data-payment-modal-overlay]');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'payment-modal-overlay';
      modal.setAttribute('data-payment-modal-overlay', '');
      modal.innerHTML = `
        <div class="payment-modal">
          <div class="payment-modal-head">
            <span class="yookassa-logo-pill">Ю<span>Kassa</span> Тестовый шлюз</span>
            <button type="button" class="checkout-close-btn" data-close-pay-modal aria-label="Закрыть">✕</button>
          </div>
          <div class="payment-modal-body">
            <div class="payment-amount-box">
              <span>Заказ №${orderNumber}</span>
              <h2>${formatPrice(amount)}</h2>
            </div>
            <div class="test-card-box">
              <strong>Тестовый режим оплаты:</strong><br>
              Карта: <code>1111 1111 1111 1026</code><br>
              Срок: <code>12/28</code> • CVC: <code>000</code><br>
              Транзакция проводится без списания реальных средств (0 ₽).
            </div>
            <button class="cart-checkout-btn" style="width: 100%; justify-content: center;" id="btn-confirm-test-pay">
              Оплатить 0 ₽ (Тест)
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('[data-close-pay-modal]').addEventListener('click', () => {
        modal.classList.remove('is-open');
        document.body.style.overflow = '';
      });

      modal.querySelector('#btn-confirm-test-pay').addEventListener('click', async () => {
        const btn = modal.querySelector('#btn-confirm-test-pay');
        btn.disabled = true;
        btn.textContent = 'Проверка транзакции...';
        clear();
        setTimeout(() => {
          window.location.href = `/order-success.html?orderId=${orderId}`;
        }, 1200);
      });
    } else {
      modal.querySelector('.payment-amount-box span').textContent = `Заказ №${orderNumber}`;
      modal.querySelector('.payment-amount-box h2').textContent = formatPrice(amount);
    }

    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function showToast(message) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span style="color:#f5a20a;font-weight:bold;">✓</span> <div>${message}</div>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.2s';
      setTimeout(() => toast.remove(), 200);
    }, 2800);
  }

  // Global click delegations
  document.addEventListener('click', (e) => {
    // Open cart drawer
    const trigger = e.target.closest('[data-cart-open]');
    if (trigger) {
      e.preventDefault();
      openDrawer();
      return;
    }

    // Close cart drawer
    const closeBtn = e.target.closest('[data-cart-close]');
    if (closeBtn) {
      closeDrawer();
      return;
    }

    // Remove item from cart
    const removeBtn = e.target.closest('[data-cart-remove]');
    if (removeBtn) {
      const idx = parseInt(removeBtn.dataset.cartRemove, 10);
      removeItem(idx);
      return;
    }

    // Proceed to checkout
    const checkoutBtn = e.target.closest('[data-cart-checkout]');
    if (checkoutBtn) {
      e.preventDefault();
      const items = getItems();
      if (!items || items.length === 0) {
        showToast('Корзина пуста');
        return;
      }
      // Business requirement: user must be registered / logged in to checkout and track order
      const userToken = localStorage.getItem('user_token');
      if (!userToken) {
        openAuthRequiredModal();
      } else {
        openCheckoutModal();
      }
      return;
    }

    // Close checkout modal
    const checkoutClose = e.target.closest('[data-checkout-close]');
    if (checkoutClose) {
      closeCheckoutModal();
      return;
    }

    // Direct add-to-cart buttons on popular preset cards
    const addPresetBtn = e.target.closest('[data-add-preset]');
    if (addPresetBtn) {
      e.preventDefault();
      const card = addPresetBtn.closest('[data-preset-card]');
      if (card) {
        const title = card.querySelector('.preset-title')?.textContent || 'Дом';
        const price = card.dataset.presetPrice;
        const image = card.querySelector('img')?.src;
        const details = {
          'Размер': card.dataset.presetDimensions || '',
          'Площадь': card.dataset.presetArea || '',
          'Серия': card.dataset.presetSeries || 'Алтай'
        };
        addItem({ title, price: Number(price), image, details });
        openDrawer();
      }
      return;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    updateBadges();

    const forms = document.querySelectorAll('[data-checkout-form], #checkoutForm');
    forms.forEach(form => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handleCheckout(form);
      });
    });

    const cartOverlay = document.querySelector('[data-cart-overlay]');
    if (cartOverlay) {
      cartOverlay.addEventListener('click', (e) => {
        if (e.target === cartOverlay) closeDrawer();
      });
    }

    const checkoutOverlay = document.querySelector('[data-checkout-modal]');
    if (checkoutOverlay) {
      checkoutOverlay.addEventListener('click', (e) => {
        if (e.target === checkoutOverlay) closeCheckoutModal();
      });
    }
  });

  return {
    getItems,
    addItem,
    removeItem,
    clear,
    openDrawer,
    closeDrawer,
    openCheckoutModal,
    closeCheckoutModal,
    showToast
  };
})();
