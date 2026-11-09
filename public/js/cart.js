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

  function openCheckoutModal() {
    closeDrawer();
    const modal = document.querySelector('[data-checkout-modal]');
    if (!modal) return;

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
    const payload = {
      customerName: formData.get('name'),
      customerPhone: formData.get('phone'),
      customerEmail: formData.get('email'),
      customerAddress: formData.get('address'),
      customerComment: formData.get('comment'),
      items
    };

    if (!payload.customerName || !payload.customerPhone) {
      showToast('Пожалуйста, укажите имя и телефон');
      return;
    }

    const submitBtn = formEl.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Оформление...';
    }

    try {
      // 1. Create order
      const createRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const orderData = await createRes.json();
      if (!createRes.ok) throw new Error(orderData.error || 'Ошибка создания заказа');

      // 2. Initiate payment
      const payRes = await fetch(`/api/orders/${orderData.orderId}/pay`, { method: 'POST' });
      const payData = await payRes.json();
      if (!payRes.ok) throw new Error(payData.error || 'Ошибка инициализации оплаты');

      closeCheckoutModal();

      // If YooKassa returns a real confirmation URL (redirect flow)
      if (payData.confirmationUrl) {
        clear();
        window.location.href = payData.confirmationUrl;
        return;
      }

      // If sandbox flow, show interactive payment modal or redirect
      showPaymentModal(orderData.orderId, orderData.orderNumber, orderData.totalPrice);
    } catch (err) {
      showToast('Ошибка: ' + err.message);
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
      openCheckoutModal();
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
