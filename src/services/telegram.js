// Сервис отправки уведомлений администратору в Telegram (src/services/telegram.js).
// Отправляет карточки новых заявок и оплаченных заказов в Telegram-чат/канал через официальный Bot API.
// Настройки считываются из таблицы settings (telegram_bot_token, telegram_chat_id) или из .env.

const https = require('https');
const db = require('../db/database');

function getTelegramSettings() {
  try {
    const rows = db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?)').all('telegram_bot_token', 'telegram_chat_id');
    const map = {};
    for (const r of rows) map[r.key] = r.value;
    return {
      botToken: map.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: map.telegram_chat_id || process.env.TELEGRAM_CHAT_ID || ''
    };
  } catch (e) {
    return {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || ''
    };
  }
}

async function sendMessage(text, parseMode = 'HTML') {
  const { botToken, chatId } = getTelegramSettings();
  if (!botToken || !chatId) {
    // Сервис не настроен — пропускаем без ошибок
    return { success: false, skipped: true, reason: 'Telegram Bot Token или Chat ID не настроены' };
  }

  const payload = JSON.stringify({
    chat_id: chatId.trim(),
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${botToken.trim()}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 6000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) {
            resolve({ success: true, messageId: parsed.result.message_id });
          } else {
            console.error('Telegram API error:', parsed.description);
            resolve({ success: false, error: parsed.description });
          }
        } catch (e) {
          resolve({ success: false, error: 'Ошибка разбора ответа Telegram' });
        }
      });
    });

    req.on('error', (err) => {
      console.error('Ошибка отправки в Telegram:', err.message);
      resolve({ success: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Таймаут подключения к Telegram API' });
    });

    req.write(payload);
    req.end();
  });
}

// Уведомление о новом заказе
async function sendOrderNotification(order) {
  const isPaid = order.payment_status === 'PAID';
  const statusEmoji = isPaid ? '✅' : '🆕';
  const priceFormatted = new Intl.NumberFormat('ru-RU').format(order.total_price);

  const itemsList = Array.isArray(order.items)
    ? order.items.map(it => `• <b>${it.title}</b> (${new Intl.NumberFormat('ru-RU').format(it.price)} ₽)`).join('\n')
    : '—';

  const message = `
${statusEmoji} <b>Новый заказ: #${order.order_number}</b>
Сумма: <b>${priceFormatted} ₽</b>
Статус: <b>${isPaid ? 'ОПЛАЧЕН' : 'Ожидает оплаты'}</b>

👤 <b>Клиент:</b> ${order.customer_name || 'Не указано'}
📞 <b>Телефон:</b> <code>${order.customer_phone || '—'}</code>
📧 <b>Email:</b> ${order.customer_email || '—'}
📍 <b>Адрес:</b> ${order.customer_address || 'Самовывоз / Не указан'}

📦 <b>Состав заказа:</b>
${itemsList}
  `.trim();

  return await sendMessage(message);
}

// Уведомление о новой заявке (лиде)
async function sendLeadNotification(lead) {
  const message = `
🔔 <b>Новая заявка с сайта MODUL.HAUS</b>

👤 <b>Имя:</b> ${lead.customer_name || 'Без имени'}
📞 <b>Телефон:</b> <code>${lead.customer_phone || '—'}</code>
💬 <b>Проект / Вопрос:</b> ${lead.customer_comment || 'Заявка на консультацию'}
  `.trim();

  return await sendMessage(message);
}

module.exports = {
  sendMessage,
  sendOrderNotification,
  sendLeadNotification,
  getTelegramSettings
};
