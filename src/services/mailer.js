const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '../../data/outbox.log');

// Helper to append notification to local log
function logNotification(payload) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      ...payload
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[Mailer Log Error]:', err);
  }
}

async function sendOrderNotification(order) {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || 'orders@modul-haus.ru';
  const subject = `[MODUL.HAUS] Новый заказ #${order.order_number} на сумму ${new Intl.NumberFormat('ru-RU').format(order.total_price)} ₽`;

  const text = `
Новый заказ на сайте MODUL.HAUS!
---------------------------------------
Номер заказа: ${order.order_number}
Клиент: ${order.customer_name}
Телефон: ${order.customer_phone}
Email: ${order.customer_email || 'не указан'}
Адрес доставки: ${order.customer_address || 'не указан'}
Комментарий: ${order.customer_comment || '—'}
Итоговая сумма: ${new Intl.NumberFormat('ru-RU').format(order.total_price)} ₽
Статус: ${order.status || 'NEW'}
Дата: ${new Date().toLocaleString('ru-RU')}
---------------------------------------
Состав заказа:
${Array.isArray(order.items) ? order.items.map((it, idx) => `${idx + 1}. ${it.title} (${it.price} ₽ x ${it.quantity || 1})`).join('\n') : ''}
  `.trim();

  console.log(`\n========================================\n📧 [EMAIL TO ${adminEmail}]:\nТема: ${subject}\n\n${text}\n========================================\n`);

  logNotification({
    type: 'order',
    to: adminEmail,
    subject,
    text,
    orderNumber: order.order_number,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    totalPrice: order.total_price
  });

  return { success: true };
}

async function sendLeadNotification(lead) {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || 'orders@modul-haus.ru';
  const subject = `[MODUL.HAUS] Новая заявка на консультацию / расчет от ${lead.customer_name}`;

  const text = `
Новая заявка с сайта MODUL.HAUS!
---------------------------------------
Имя клиента: ${lead.customer_name}
Телефон: ${lead.customer_phone}
Комментарий / расчет: ${lead.customer_comment || 'Заявка на консультацию'}
Дата: ${new Date().toLocaleString('ru-RU')}
---------------------------------------
  `.trim();

  console.log(`\n========================================\n📧 [EMAIL TO ${adminEmail}]:\nТема: ${subject}\n\n${text}\n========================================\n`);

  logNotification({
    type: 'lead',
    to: adminEmail,
    subject,
    text,
    customerName: lead.customer_name,
    customerPhone: lead.customer_phone
  });

  return { success: true };
}

function getOutbox() {
  if (!fs.existsSync(logPath)) return [];
  try {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    return lines.map(l => JSON.parse(l)).reverse();
  } catch (e) {
    return [];
  }
}

module.exports = {
  sendOrderNotification,
  sendLeadNotification,
  getOutbox
};
