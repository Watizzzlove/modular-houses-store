// Клиентская логика панели администратора (public/js/admin.js).
// Обеспечивает:
// - авторизацию администратора по JWT токену и сохранение сессии в localStorage
// - переключение между вкладками: каталог, управление фото, контент страниц, настройки ЮKassa/почты, заказы, журнал писем
// - каскадные фильтры фотогалереи (по категории, серии, размеру и цвету) и загрузку новых снимков
// - редактирование цен и статусов заказов (NEW, PAID, IN_PRODUCTION, DELIVERING, COMPLETED)
// - просмотр журнала отправленных email-уведомлений менеджерам

const Admin = (function () {
  let token = localStorage.getItem('doka_admin_token');
  let currentTab = 'catalog';

  function init() {
    bindEvents();
    if (token) {
      checkAuth();
    } else {
      showAuthOverlay(true);
    }
  }

  function showAuthOverlay(show, isRegister = false) {
    const overlay = document.querySelector('[data-admin-auth-overlay]');
    if (!overlay) return;
    overlay.style.display = show ? 'flex' : 'none';

    const loginBox = document.querySelector('[data-auth-login-box]');
    const regBox = document.querySelector('[data-auth-reg-box]');
    if (loginBox && regBox) {
      loginBox.style.display = isRegister ? 'none' : 'block';
      regBox.style.display = isRegister ? 'block' : 'none';
    }
  }

  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const { user } = await res.json();
        const userEl = document.querySelector('[data-admin-user-email]');
        if (userEl) userEl.textContent = user.email;
        showAuthOverlay(false);
        switchTab(currentTab);
      } else {
        logout();
      }
    } catch (e) {
      logout();
    }
  }

  function logout() {
    token = null;
    localStorage.removeItem('doka_admin_token');
    showAuthOverlay(true);
  }

  function switchTab(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.admin-nav-item').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.tab === tabName);
    });

    document.querySelectorAll('[data-tab-content]').forEach(section => {
      section.style.display = section.dataset.tabContent === tabName ? 'block' : 'none';
    });

    if (tabName === 'catalog') loadCatalogTab();
    if (tabName === 'media') loadMediaTab();
    if (tabName === 'content') loadContentTab();
    if (tabName === 'settings') loadSettingsTab();
    if (tabName === 'orders') loadOrdersTab();
    if (tabName === 'outbox') loadOutboxTab();
  }

  // --- CATALOG & PRICES TAB ---
  async function loadCatalogTab() {
    const container = document.querySelector('[data-admin-series-list]');
    if (!container) return;
    container.innerHTML = '<tr><td colspan="5">Загрузка каталога...</td></tr>';

    try {
      const res = await fetch('/api/admin/series', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const { series } = await res.json();

      container.innerHTML = series.map(s => `
        <tr>
          <td><strong>${s.name}</strong> (${s.category_name})</td>
          <td>${s.tagline || '—'}</td>
          <td>от ${formatPrice(s.base_price)}</td>
          <td>${s.config_count} размеров • ${s.media_count} фото</td>
          <td>
            <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="Admin.viewConfigs(${s.id}, '${s.name}')">
              Управление ценами
            </button>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      container.innerHTML = `<tr><td colspan="5" style="color:red">Ошибка: ${e.message}</td></tr>`;
    }
  }

  async function viewConfigs(seriesId, seriesName) {
    const modal = document.querySelector('[data-configs-modal]');
    const titleEl = document.querySelector('[data-configs-series-name]');
    const listEl = document.querySelector('[data-configs-list]');
    const seriesIdInput = document.querySelector('[data-add-config-series-id]');

    if (!modal) return;
    if (titleEl) titleEl.textContent = `Размеры и цены: ${seriesName}`;
    if (seriesIdInput) seriesIdInput.value = seriesId;
    listEl.innerHTML = '<tr><td colspan="5">Загрузка...</td></tr>';
    modal.style.display = 'flex';

    try {
      const res = await fetch(`/api/admin/configurations/${seriesId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const { configurations } = await res.json();

      listEl.innerHTML = configurations.map(c => `
        <tr>
          <td><strong>${c.label}</strong> (${c.key})</td>
          <td>${c.area} м² (${c.width} × ${c.length} м)</td>
          <td>
            <input type="number" class="form-input" style="width: 140px; padding: 6px;" id="price-cfg-${c.id}" value="${c.price}">
          </td>
          <td>
            <button class="btn btn-primary" style="padding: 6px 10px; font-size: 12px;" onclick="Admin.saveConfigPrice(${c.id})">
              Сохранить
            </button>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      listEl.innerHTML = `<tr><td colspan="5" style="color:red">Ошибка: ${e.message}</td></tr>`;
    }
  }

  async function saveConfigPrice(cfgId) {
    const input = document.getElementById(`price-cfg-${cfgId}`);
    if (!input) return;
    const newPrice = parseInt(input.value, 10);

    try {
      const res = await fetch(`/api/admin/configurations/${cfgId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ price: newPrice })
      });
      if (res.ok) {
        alert('Цена успешно сохранена!');
        loadCatalogTab();
      }
    } catch (e) {
      alert('Ошибка сохранения: ' + e.message);
    }
  }

  async function addNewConfig(form) {
    const formData = new FormData(form);
    const payload = {
      seriesId: formData.get('seriesId'),
      key: formData.get('key'),
      label: formData.get('label'),
      width: parseFloat(formData.get('width')),
      length: parseFloat(formData.get('length')),
      area: parseFloat(formData.get('area')),
      price: parseInt(formData.get('price'), 10)
    };

    try {
      const res = await fetch('/api/admin/configurations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert('Новый размер добавлен!');
        form.reset();
        viewConfigs(payload.seriesId, '');
        loadCatalogTab();
      } else {
        const err = await res.json();
        alert('Ошибка: ' + (err.error || 'Не удалось сохранить'));
      }
    } catch (e) {
      alert('Ошибка: ' + e.message);
    }
  }

  // --- MEDIA TAB ---
  let cachedSeriesList = null;

  async function loadMediaTab() {
    const catSelect = document.querySelector('[data-media-cat-select]');
    const seriesSelect = document.querySelector('[data-media-series-select]');
    const colorSelect = document.querySelector('[data-media-color-select]');
    const kindSelect = document.querySelector('[data-media-kind-select]');
    const countBadge = document.querySelector('[data-media-count-badge]');
    const grid = document.querySelector('[data-admin-media-grid]');
    if (!grid) return;

    // Load series list once
    if (!cachedSeriesList) {
      try {
        const res = await fetch('/api/admin/series', { headers: { 'Authorization': `Bearer ${token}` } });
        const { series } = await res.json();
        cachedSeriesList = series || [];

        // Populate upload select
        const uploadSeriesSelect = document.querySelector('[data-upload-series-select]');
        if (uploadSeriesSelect) {
          uploadSeriesSelect.innerHTML = cachedSeriesList.map(s => 
            `<option value="${s.id}">[${s.category_name}] ${s.name}</option>`
          ).join('');
        }
      } catch (e) {
        cachedSeriesList = [];
      }
    }

    // Populate series filter dropdown based on category
    if (seriesSelect && cachedSeriesList) {
      const selectedCat = catSelect ? catSelect.value : 'all';
      const prevVal = seriesSelect.value || 'all';

      let filteredSeries = cachedSeriesList;
      if (selectedCat !== 'all') {
        filteredSeries = cachedSeriesList.filter(s => String(s.category_id) === String(selectedCat));
      }

      seriesSelect.innerHTML = '<option value="all">Все серии</option>' + 
        filteredSeries.map(s => `<option value="${s.id}">[${s.category_name}] ${s.name}</option>`).join('');

      // Restore previously chosen series if still available
      if (filteredSeries.some(s => String(s.id) === String(prevVal))) {
        seriesSelect.value = prevVal;
      }
    }

    const catId = catSelect ? catSelect.value : 'all';
    const seriesId = seriesSelect ? seriesSelect.value : 'all';
    const color = colorSelect ? colorSelect.value : 'all';
    const kind = kindSelect ? kindSelect.value : 'all';

    grid.innerHTML = '<div style="grid-column: 1/-1; padding: 24px; text-align: center; color: var(--admin-muted);">Загрузка фото...</div>';

    try {
      const queryParams = new URLSearchParams({
        categoryId: catId,
        seriesId: seriesId,
        color: color,
        kind: kind
      });

      const res = await fetch(`/api/admin/media?${queryParams.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const { items } = await res.json();

      if (countBadge) {
        countBadge.textContent = `Фото: ${items.length}`;
      }

      if (!items || items.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; padding: 36px; text-align: center; color: var(--admin-muted); background: #faf9f6; border-radius: 12px; border: 1px dashed var(--admin-line);">По выбранным фильтрам фотографии не найдены</div>';
        return;
      }

      grid.innerHTML = items.map(item => `
        <div class="admin-media-item">
          <img src="${item.url}" alt="${item.filename}" loading="lazy" onerror="this.closest('.admin-media-item').style.display='none';">
          <button type="button" class="admin-media-delete-btn" onclick="Admin.deleteMedia(${item.id})" title="Удалить фотографию">✕</button>
          <div class="admin-media-meta">
            <strong>${item.series_name}</strong> • ${item.color}<br>
            Ракурс: ${item.kind} (${item.entrance_kind || 'базовый'})
          </div>
        </div>
      `).join('');
    } catch (e) {
      grid.innerHTML = `<div style="grid-column: 1/-1; color:red; padding: 20px;">Ошибка: ${e.message}</div>`;
    }
  }

  async function uploadMedia(form) {
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Загрузка...'; }

    try {
      const res = await fetch('/api/admin/media/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        alert('Фотография успешно загружена!');
        form.reset();
        loadMediaTab();
      } else {
        alert('Ошибка загрузки: ' + (data.error || 'Неизвестная ошибка'));
      }
    } catch (e) {
      alert('Ошибка: ' + e.message);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Загрузить в галерею'; }
    }
  }

  async function deleteMedia(id) {
    if (!confirm('Вы уверены, что хотите удалить эту фотографию?')) return;
    try {
      const res = await fetch(`/api/admin/media/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        loadMediaTab();
      }
    } catch (e) {
      alert('Ошибка удаления: ' + e.message);
    }
  }

  // --- CONTENT TAB ---
  async function loadContentTab() {
    const form = document.querySelector('[data-admin-content-form]');
    if (!form) return;
    try {
      const res = await fetch('/api/admin/content', { headers: { 'Authorization': `Bearer ${token}` } });
      const { content } = await res.json();
      for (const [key, val] of Object.entries(content)) {
        const input = form.elements[key];
        if (input) input.value = val;
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function saveContent(form) {
    const data = {};
    Array.from(form.elements).forEach(el => {
      if (el.name) data[el.name] = el.value;
    });

    try {
      const res = await fetch('/api/admin/content', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      if (res.ok) alert('Контент сайта обновлен!');
    } catch (e) {
      alert('Ошибка: ' + e.message);
    }
  }

  // --- SETTINGS (YOOKASSA) TAB ---
  async function loadSettingsTab() {
    const form = document.querySelector('[data-admin-settings-form]');
    if (!form) return;
    try {
      const res = await fetch('/api/admin/settings', { headers: { 'Authorization': `Bearer ${token}` } });
      const { settings } = await res.json();
      for (const [key, val] of Object.entries(settings)) {
        const input = form.elements[key];
        if (input) input.value = val;
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function saveSettings(form) {
    const data = {};
    Array.from(form.elements).forEach(el => {
      if (el.name) data[el.name] = el.value;
    });

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      const resData = await res.json();
      if (res.ok) {
        alert('Настройки успешно сохранены!');
      } else {
        alert('Ошибка сохранения настроек: ' + (resData.error || res.statusText));
      }
    } catch (e) {
      alert('Ошибка: ' + e.message);
    }
  }

  async function testMailSettings() {
    const form = document.querySelector('[data-admin-settings-form]');
    const statusEl = document.getElementById('adminMailTestMsg');
    const testBtn = document.getElementById('btnAdminTestMail');
    if (!form || !statusEl || !testBtn) return;

    const data = {};
    Array.from(form.elements).forEach(el => {
      if (el.name) data[el.name] = el.value;
    });

    testBtn.disabled = true;
    testBtn.textContent = 'Проверка SMTP...';
    statusEl.style.display = 'block';
    statusEl.style.background = '#f3f4f6';
    statusEl.style.color = '#374151';
    statusEl.style.border = '1px solid #d1d5db';
    statusEl.textContent = 'Подключение к SMTP серверу ' + (data.smtp_host || 'smtp.mail.ru') + '...';

    try {
      const res = await fetch('/api/admin/settings/test-mail', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      const resData = await res.json();
      if (res.ok && resData.success) {
        statusEl.style.background = '#def7ec';
        statusEl.style.color = '#03543f';
        statusEl.style.border = '1px solid #31c48d';
        statusEl.innerHTML = '<strong>✓ Успешно!</strong> ' + (resData.message || 'Тестовое письмо отправлено на ' + data.admin_notify_email);
      } else {
        statusEl.style.background = '#fde8e8';
        statusEl.style.color = '#9b1c1c';
        statusEl.style.border = '1px solid #f98080';
        statusEl.innerHTML = '<strong>✕ Ошибка SMTP:</strong> ' + (resData.error || 'Не удалось отправить проверочное письмо');
      }
    } catch (err) {
      statusEl.style.background = '#fde8e8';
      statusEl.style.color = '#9b1c1c';
      statusEl.style.border = '1px solid #f98080';
      statusEl.innerHTML = '<strong>✕ Ошибка связи:</strong> ' + err.message;
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Проверить SMTP и отправить тест';
    }
  }

  // Проверка отправки тестового сообщения в Telegram
  async function testTelegramSettings() {
    const form = document.querySelector('[data-admin-settings-form]');
    const statusEl = document.getElementById('adminTelegramTestMsg');
    const testBtn = document.getElementById('btnAdminTestTelegram');
    if (!form || !statusEl || !testBtn) return;

    const data = {};
    Array.from(form.elements).forEach(el => {
      if (el.name) data[el.name] = el.value;
    });

    if (!data.telegram_bot_token || !data.telegram_chat_id) {
      statusEl.style.display = 'block';
      statusEl.style.background = '#fde8e8';
      statusEl.style.color = '#9b1c1c';
      statusEl.style.border = '1px solid #f98080';
      statusEl.innerHTML = '<strong>✕ Ошибка:</strong> Заполните Telegram Bot Token и Chat ID';
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Отправка в Telegram...';
    statusEl.style.display = 'block';
    statusEl.style.background = '#f3f4f6';
    statusEl.style.color = '#374151';
    statusEl.style.border = '1px solid #d1d5db';
    statusEl.textContent = 'Отправка тестового сообщения через Telegram Bot API...';

    try {
      const res = await fetch('/api/admin/settings/test-telegram', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      const resData = await res.json();
      if (res.ok && resData.success) {
        statusEl.style.background = '#def7ec';
        statusEl.style.color = '#03543f';
        statusEl.style.border = '1px solid #31c48d';
        statusEl.innerHTML = '<strong>✓ Успешно!</strong> ' + (resData.message || 'Тестовое уведомление доставлено в Telegram');
      } else {
        statusEl.style.background = '#fde8e8';
        statusEl.style.color = '#9b1c1c';
        statusEl.style.border = '1px solid #f98080';
        statusEl.innerHTML = '<strong>✕ Ошибка Telegram:</strong> ' + (resData.error || 'Не удалось отправить сообщение');
      }
    } catch (err) {
      statusEl.style.background = '#fde8e8';
      statusEl.style.color = '#9b1c1c';
      statusEl.style.border = '1px solid #f98080';
      statusEl.innerHTML = '<strong>✕ Ошибка связи:</strong> ' + err.message;
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Проверить отправку в Telegram';
    }
  }

  // --- ORDERS TAB ---
  async function loadOrdersTab() {
    const tbody = document.querySelector('[data-admin-orders-list]');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">Загрузка заказов...</td></tr>';

    try {
      const res = await fetch('/api/admin/orders', { headers: { 'Authorization': `Bearer ${token}` } });
      const { orders } = await res.json();

      if (!orders || orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--admin-muted); padding: 20px;">Заказов пока нет</td></tr>';
        return;
      }

      tbody.innerHTML = orders.map(o => {
        const isPaid = o.payment_status === 'PAID';
        const itemsSummary = (o.items || []).map(i => `• <strong>${i.title}</strong> (${formatPrice(i.price)} × ${i.quantity || 1})`).join('<br>');
        return `
          <tr>
            <td class="nowrap">
              <strong>${o.order_number}</strong><br>
              <small style="color:var(--admin-muted)">${new Date(o.created_at).toLocaleString('ru-RU')}</small>
            </td>
            <td class="nowrap">
              <strong>${o.customer_name}</strong><br>
              <span style="color:#444;">${o.customer_phone}</span>
              ${o.customer_email ? `<br><small style="color:var(--admin-muted)">${o.customer_email}</small>` : ''}
            </td>
            <td style="font-size:12px; max-width: 260px;">${itemsSummary || o.customer_comment || '—'}</td>
            <td class="nowrap"><strong style="color:var(--admin-accent); font-size:14px;">${formatPrice(o.total_price)}</strong></td>
            <td class="nowrap">
              <span class="badge-status ${isPaid ? 'paid' : 'pending'}">${isPaid ? '✓ ОПЛАЧЕН' : 'ОЖИДАЕТ'}</span>
              <div style="margin-top:6px;">
                <button class="btn btn-secondary btn-sm" onclick="Admin.toggleOrderStatus(${o.id}, '${isPaid ? 'PENDING' : 'PAID'}')">
                  ${isPaid ? 'Сбросить' : 'Отметить оплаченным'}
                </button>
              </div>
            </td>
            <td class="nowrap">
              <select class="form-input form-input-sm" onchange="Admin.updateLifecycleStatus(${o.id}, this.value)" style="width: auto; font-weight: 700; cursor: pointer;">
                <option value="NEW" ${o.status === 'NEW' ? 'selected' : ''}>1. Оформлен</option>
                <option value="PAID" ${o.status === 'PAID' ? 'selected' : ''}>2. Оплачен</option>
                <option value="IN_PRODUCTION" ${o.status === 'IN_PRODUCTION' ? 'selected' : ''}>3. В производстве</option>
                <option value="DELIVERING" ${o.status === 'DELIVERING' ? 'selected' : ''}>4. Доставляется</option>
                <option value="COMPLETED" ${o.status === 'COMPLETED' ? 'selected' : ''}>5. Исполнен</option>
                <option value="CANCELLED" ${o.status === 'CANCELLED' ? 'selected' : ''}>Отменён</option>
              </select>
            </td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:red; padding: 20px;">Ошибка: ${e.message}</td></tr>`;
    }
  }

  async function updateLifecycleStatus(orderId, newStatus) {
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        // Notification
      }
    } catch (e) {
      alert('Ошибка: ' + e.message);
    }
  }

  // --- OUTBOX (EMAIL NOTIFICATIONS) TAB ---
  async function loadOutboxTab() {
    const tbody = document.querySelector('[data-admin-outbox-list]');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">Загрузка уведомлений...</td></tr>';
    try {
      const res = await fetch('/api/admin/outbox', { headers: { 'Authorization': `Bearer ${token}` } });
      const { outbox } = await res.json();
      if (!outbox || outbox.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--admin-muted); padding: 20px;">Уведомлений пока нет</td></tr>';
        return;
      }
      tbody.innerHTML = outbox.map(m => {
        let statusBadge = '<span class="badge-status pending">В очереди</span>';
        if (m.status === 'SENT_SMTP') {
          statusBadge = '<span class="badge-status paid" title="' + (m.details || '') + '">✓ SMTP ОТПРАВЛЕНО</span>';
        } else if (m.status === 'ERROR_SMTP') {
          statusBadge = '<span class="badge-status" style="background:#fde8e8;color:#9b1c1c;" title="' + (m.details || '') + '">✕ ОШИБКА SMTP</span>';
        } else if (m.status === 'SENT_FORMSUBMIT') {
          statusBadge = '<span class="badge-status paid">✓ FORMSUBMIT</span>';
        } else if (m.status === 'ERROR_FORMSUBMIT') {
          statusBadge = '<span class="badge-status" style="background:#fde8e8;color:#9b1c1c;">✕ FORMSUBMIT</span>';
        }

        const typeLabel = m.type === 'order' ? 'ЗАКАЗ' : (m.type === 'test' ? 'ТЕСТ' : 'ЗАЯВКА');
        const typeBadge = '<span class="badge-status ' + (m.type === 'order' ? 'paid' : (m.type === 'test' ? '' : 'pending')) + '">' + typeLabel + '</span>';

        return `
          <tr>
            <td class="nowrap"><small>${new Date(m.timestamp).toLocaleString('ru-RU')}</small></td>
            <td class="nowrap">${typeBadge}</td>
            <td class="nowrap">${statusBadge}</td>
            <td class="nowrap">${m.to || 'orders@modul-haus.ru'}</td>
            <td>
              <strong>${m.subject}</strong>
              ${m.details ? `<br><small style="color:${m.status && m.status.startsWith('ERROR') ? '#c81e1e' : 'var(--admin-muted)'};">${m.details}</small>` : ''}
            </td>
            <td class="nowrap"><strong>${m.customerName || '—'}</strong><br>${m.customerPhone || '—'}</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:red; padding: 20px;">Ошибка: ${e.message}</td></tr>`;
    }
  }

  async function toggleOrderStatus(orderId, newStatus) {
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ paymentStatus: newStatus })
      });
      if (res.ok) loadOrdersTab();
    } catch (e) {
      alert('Ошибка: ' + e.message);
    }
  }

  function formatPrice(val) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(val) || 0) + ' ₽';
  }

  function bindEvents() {
    // Nav tabs
    document.addEventListener('click', (e) => {
      const navItem = e.target.closest('.admin-nav-item');
      if (navItem && navItem.dataset.tab) {
        switchTab(navItem.dataset.tab);
      }

      // Logout
      if (e.target.closest('[data-admin-logout]')) {
        logout();
      }

      // Toggle Auth forms
      if (e.target.closest('[data-switch-to-reg]')) {
        e.preventDefault();
        showAuthOverlay(true, true);
      }
      if (e.target.closest('[data-switch-to-login]')) {
        e.preventDefault();
        showAuthOverlay(true, false);
      }

      // Close modal
      if (e.target.closest('[data-close-configs-modal]')) {
        const modal = document.querySelector('[data-configs-modal]');
        if (modal) modal.style.display = 'none';
      }
    });

    // Login Form Submit
    const loginForm = document.querySelector('[data-login-form]');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = loginForm.email.value;
        const password = loginForm.password.value;
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
          });
          const data = await res.json();
          if (res.ok && data.token) {
            token = data.token;
            localStorage.setItem('doka_admin_token', token);
            checkAuth();
          } else {
            alert(data.error || 'Неверный логин или пароль');
          }
        } catch (err) {
          alert('Ошибка связи с сервером');
        }
      });
    }

    // Register Form Submit
    const regForm = document.querySelector('[data-reg-form]');
    if (regForm) {
      regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = regForm.email.value;
        const password = regForm.password.value;
        try {
          const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
          });
          const data = await res.json();
          if (res.ok && data.token) {
            token = data.token;
            localStorage.setItem('doka_admin_token', token);
            alert('Администратор успешно зарегистрирован!');
            checkAuth();
          } else {
            alert(data.error || 'Ошибка регистрации');
          }
        } catch (err) {
          alert('Ошибка связи с сервером');
        }
      });
    }

    // Media Filters change bindings
    const mediaCatSelect = document.querySelector('[data-media-cat-select]');
    const mediaSeriesSelect = document.querySelector('[data-media-series-select]');
    const mediaColorSelect = document.querySelector('[data-media-color-select]');
    const mediaKindSelect = document.querySelector('[data-media-kind-select]');
    const mediaResetBtn = document.querySelector('[data-media-reset-btn]');

    if (mediaCatSelect) {
      mediaCatSelect.addEventListener('change', () => {
        if (mediaSeriesSelect) mediaSeriesSelect.value = 'all';
        loadMediaTab();
      });
    }

    if (mediaSeriesSelect) {
      mediaSeriesSelect.addEventListener('change', loadMediaTab);
    }

    if (mediaColorSelect) {
      mediaColorSelect.addEventListener('change', loadMediaTab);
    }

    if (mediaKindSelect) {
      mediaKindSelect.addEventListener('change', loadMediaTab);
    }

    if (mediaResetBtn) {
      mediaResetBtn.addEventListener('click', () => {
        if (mediaCatSelect) mediaCatSelect.value = 'all';
        if (mediaSeriesSelect) mediaSeriesSelect.value = 'all';
        if (mediaColorSelect) mediaColorSelect.value = 'all';
        if (mediaKindSelect) mediaKindSelect.value = 'all';
        loadMediaTab();
      });
    }

    // Modal Close Button
    const closeConfigsBtn = document.querySelector('[data-close-configs-modal]');
    if (closeConfigsBtn) {
      closeConfigsBtn.addEventListener('click', () => {
        const modal = document.querySelector('[data-configs-modal]');
        if (modal) modal.style.display = 'none';
      });
    }

    // Mobile Sidebar Drawer Toggle
    const adminSidebar = document.querySelector('.admin-sidebar');
    if (adminSidebar) {
      adminSidebar.addEventListener('click', (e) => {
        if (window.innerWidth <= 850 && !e.target.closest('.admin-nav-item')) {
          adminSidebar.classList.toggle('is-mobile-open');
        }
      });
      document.querySelectorAll('.admin-nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
          if (adminSidebar.classList.contains('is-mobile-open')) {
            adminSidebar.classList.remove('is-mobile-open');
          }
        });
      });
    }

    // Upload Media Form
    const uploadForm = document.querySelector('[data-upload-media-form]');
    if (uploadForm) {
      uploadForm.addEventListener('submit', (e) => {
        e.preventDefault();
        uploadMedia(uploadForm);
      });
    }

    // Content Form
    const contentForm = document.querySelector('[data-admin-content-form]');
    if (contentForm) {
      contentForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveContent(contentForm);
      });
    }

    // Settings Form
    const settingsForm = document.querySelector('[data-admin-settings-form]');
    if (settingsForm) {
      settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveSettings(settingsForm);
      });
    }

    // Test Mail Button
    const btnTestMail = document.getElementById('btnAdminTestMail');
    if (btnTestMail) {
      btnTestMail.addEventListener('click', (e) => {
        e.preventDefault();
        testMailSettings();
      });
    }

    // Test Telegram Button
    const btnTestTelegram = document.getElementById('btnAdminTestTelegram');
    if (btnTestTelegram) {
      btnTestTelegram.addEventListener('click', (e) => {
        e.preventDefault();
        testTelegramSettings();
      });
    }

    // Add config form
    const addConfigForm = document.querySelector('[data-add-config-form]');
    if (addConfigForm) {
      addConfigForm.addEventListener('submit', (e) => {
        e.preventDefault();
        addNewConfig(addConfigForm);
      });
    }
  }

  return {
    init,
    viewConfigs,
    saveConfigPrice,
    deleteMedia,
    toggleOrderStatus,
    updateLifecycleStatus,
    loadOutboxTab
  };
})();

document.addEventListener('DOMContentLoaded', Admin.init);
