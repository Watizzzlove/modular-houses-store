// Сервис отправки почтовых уведомлений администратору (src/services/mailer.js).
// Поддерживает:
// 1) Прямой SMTP через nodemailer: если выбран сервис smtp (по умолчанию) и заполнен пароль приложения,
//    письмо отправляется напрямую через почтовый сервер (smtp.mail.ru, smtp.yandex.ru и т.д.) без сторонних шлюзов.
// 2) FormSubmit HTTP Relay: резервный веб-шлюз, используется ТОЛЬКО если администратор явно выбрал formsubmit.
// 3) Локальный журнал outbox (data/outbox.log) для отображения истории писем и их статусов доставки в админ-панели.

const fs = require('fs');
const path = require('path');
const db = require('../db/database');

let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  // Опциональный SMTP транспорт, если nodemailer доступен
}

const logPath = path.join(__dirname, '../../data/outbox.log');

// Получение актуальных почтовых настроек из таблицы settings
function getNotifySettings() {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const map = {};
    for (const r of rows) map[r.key] = r.value;
    return {
      adminEmail: map.admin_notify_email || process.env.ADMIN_NOTIFY_EMAIL || 'watislove@internet.ru',
      smtpHost: map.smtp_host || process.env.SMTP_HOST || 'smtp.mail.ru',
      smtpPort: Number(map.smtp_port) || Number(process.env.SMTP_PORT) || 465,
      smtpUser: map.smtp_user || map.admin_notify_email || process.env.SMTP_USER || 'watislove@internet.ru',
      smtpPass: (map.smtp_pass || process.env.SMTP_PASS || '').trim(),
      mailService: map.mail_service || 'smtp'
    };
  } catch (e) {
    return {
      adminEmail: 'watislove@internet.ru',
      smtpHost: 'smtp.mail.ru',
      smtpPort: 465,
      smtpUser: 'watislove@internet.ru',
      smtpPass: '',
      mailService: 'smtp'
    };
  }
}

// Запись события отправки в локальный журнал исходящих сообщений
function logNotification(payload) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      ...payload
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('Ошибка записи в лог уведомлений:', err.message);
  }
}

// Отправка письма через прямой SMTP
async function sendViaSmtp(settings, mailOptions) {
  if (!nodemailer) {
    return { success: false, error: 'Модуль nodemailer недоступен' };
  }
  if (!settings.smtpPass) {
    return { success: false, error: 'Пароль приложения SMTP не заполнен' };
  }

  try {
    const user = (settings.smtpUser || settings.adminEmail).trim();
    const pass = settings.smtpPass.replace(/\s+/g, '');
    const port = Number(settings.smtpPort) || 465;

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost || 'smtp.mail.ru',
      port,
      secure: port === 465,
      auth: {
        user,
        pass
      }
    });

    const info = await transporter.sendMail({
      from: `"MODUL.HAUS" <${user}>`,
      to: settings.adminEmail,
      subject: mailOptions.subject,
      text: mailOptions.text,
      html: mailOptions.html
    });

    console.log(`[SMTP Отправлено -> ${settings.adminEmail}]: MessageId ${info.messageId}`);
    return { success: true, provider: 'smtp', messageId: info.messageId };
  } catch (err) {
    console.warn(`[SMTP Ошибка -> ${settings.adminEmail}]:`, err.message);
    return { success: false, error: err.message };
  }
}

// Отправка письма через FormSubmit API (только если явно выбран formsubmit)
async function sendViaFormSubmit(targetEmail, subject, data) {
  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(targetEmail)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://modul-haus.ru',
        'Referer': 'https://modul-haus.ru/'
      },
      body: JSON.stringify({
        ...data,
        _subject: subject,
        _template: 'table'
      })
    });
    const result = await res.json();
    console.log(`[FormSubmit -> ${targetEmail}]:`, result.message || result);
    return { success: true, provider: 'formsubmit', details: result };
  } catch (err) {
    console.warn(`[FormSubmit Ошибка -> ${targetEmail}]:`, err.message);
    return { success: false, error: err.message };
  }
}

// Универсальный диспетчер отправки email
async function dispatchEmail({ subject, text, html, data, logMeta }) {
  const settings = getNotifySettings();
  const adminEmail = settings.adminEmail;

  console.log(`\n========================================\n[EMAIL DISPATCH TO ${adminEmail} (Сервис: ${settings.mailService})]:\nТема: ${subject}\n\n${text}\n========================================\n`);

  let status = 'PENDING';
  let details = '';

  // 1) Если включен прямой SMTP (по умолчанию)
  if (settings.mailService === 'smtp' || (!settings.mailService && settings.smtpPass)) {
    const smtpRes = await sendViaSmtp(settings, { subject, text, html });
    if (smtpRes && smtpRes.success) {
      status = 'SENT_SMTP';
      details = `Успешно доставлено через ${settings.smtpHost} (id: ${smtpRes.messageId})`;
    } else {
      // Отказоустойчивый fallback на FormSubmit Relay
      console.warn(`[Dual Relay Fallback]: SMTP не удался (${smtpRes ? smtpRes.error : 'ошибка'}), переключаемся на FormSubmit Relay...`);
      const fsRes = await sendViaFormSubmit(adminEmail, subject, data);
      if (fsRes && fsRes.success) {
        status = 'SENT_FORMSUBMIT';
        details = `Отправлено через FormSubmit Relay (fallback после ошибки SMTP)`;
      } else {
        status = 'ERROR_SMTP';
        details = smtpRes ? smtpRes.error : 'Пароль приложения SMTP не заполнен';
      }
    }
  } else if (settings.mailService === 'formsubmit') {
    // 2) FormSubmit вызывается ТОЛЬКО если пользователь сознательно выбрал его в админке
    const fsRes = await sendViaFormSubmit(adminEmail, subject, data);
    if (fsRes && fsRes.success) {
      status = 'SENT_FORMSUBMIT';
      details = 'Отправлено через FormSubmit';
    } else {
      status = 'ERROR_FORMSUBMIT';
      details = fsRes ? fsRes.error : 'Ошибка вызова FormSubmit';
    }
  } else {
    status = 'SKIPPED';
    details = 'Почтовые уведомления отключены';
  }

  logNotification({
    ...logMeta,
    to: adminEmail,
    subject,
    text,
    provider: settings.mailService,
    status,
    details
  });

  return { success: status.startsWith('SENT'), status, details, to: adminEmail };
}

// Тестирование подключения к SMTP серверу и отправка проверочного письма
async function testSmtpConnection(overrideSettings = {}) {
  const base = getNotifySettings();
  const settings = {
    adminEmail: overrideSettings.admin_notify_email || overrideSettings.adminEmail || base.adminEmail,
    smtpHost: overrideSettings.smtp_host || overrideSettings.smtpHost || base.smtpHost,
    smtpPort: Number(overrideSettings.smtp_port) || Number(overrideSettings.smtpPort) || base.smtpPort,
    smtpUser: overrideSettings.smtp_user || overrideSettings.smtpUser || base.smtpUser,
    smtpPass: (overrideSettings.smtp_pass !== undefined ? overrideSettings.smtp_pass : (overrideSettings.smtpPass !== undefined ? overrideSettings.smtpPass : base.smtpPass) || '').trim(),
    mailService: overrideSettings.mail_service || overrideSettings.mailService || base.mailService
  };

  if (!nodemailer) {
    return { success: false, error: 'Модуль nodemailer не установлен на сервере' };
  }

  const pass = (settings.smtpPass || '').trim().replace(/\s+/g, '');
  if (!pass) {
    return { success: false, error: 'Пароль приложения SMTP не указан. Пожалуйста, введите 16-значный пароль приложения.' };
  }

  try {
    const user = (settings.smtpUser || settings.adminEmail).trim();
    const port = Number(settings.smtpPort) || 465;

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost || 'smtp.mail.ru',
      port,
      secure: port === 465,
      auth: {
        user,
        pass
      }
    });

    // Проверка логина и пароля на сервере
    await transporter.verify();

    // Отправка реального тестового письма
    const subject = '[MODUL.HAUS] Проверка тестовой отправки через SMTP';
    const text = `
Поздравляем! Прямое подключение к SMTP серверу настроено правильно.

Параметры соединения:
Сервер: ${settings.smtpHost}:${port}
Логин: ${user}
Получатель: ${settings.adminEmail}
Время отправки: ${new Date().toLocaleString('ru-RU')}

Теперь все новые заявки и заказы с сайта MODUL.HAUS приходят напрямую на вашу почту без внешних сервисов и активаций.
    `.trim();

    const info = await transporter.sendMail({
      from: `"MODUL.HAUS" <${user}>`,
      to: settings.adminEmail,
      subject,
      text
    });

    logNotification({
      type: 'test',
      to: settings.adminEmail,
      subject,
      text,
      provider: 'smtp',
      status: 'SENT_SMTP',
      details: `Тестовое письмо доставлено. MessageId: ${info.messageId}`
    });

    return {
      success: true,
      to: settings.adminEmail,
      messageId: info.messageId,
      message: `Тестовое письмо успешно отправлено на ${settings.adminEmail}!`
    };
  } catch (err) {
    let friendlyError = err.message;
    if (friendlyError.includes('535') || friendlyError.includes('NEOBHODIM parol prilozheniya') || friendlyError.includes('Invalid login')) {
      friendlyError = 'Ошибка авторизации Mail.ru (код 535): Mail.ru требует специальный 16-буквенный «Пароль для внешних приложений». Создайте его в разделе: account.mail.ru -> Безопасность -> Пароли для внешних приложений.';
    }
    return { success: false, error: friendlyError };
  }
}

// Уведомление о новом оплаченном или оформленном заказе
async function sendOrderNotification(order) {
  const subject = `[MODUL.HAUS] Новый заказ #${order.order_number} на сумму ${new Intl.NumberFormat('ru-RU').format(order.total_price)} руб.`;

  const itemsText = Array.isArray(order.items)
    ? order.items.map((it, idx) => `${idx + 1}. ${it.title} (${new Intl.NumberFormat('ru-RU').format(it.price)} руб. x ${it.quantity || 1})`).join('\n')
    : '';

  const text = `
Новый заказ на сайте MODUL.HAUS!
---------------------------------------
Номер заказа: ${order.order_number}
Клиент: ${order.customer_name}
Телефон: ${order.customer_phone}
Email: ${order.customer_email || 'не указан'}
Адрес доставки: ${order.customer_address || 'не указан'}
Комментарий: ${order.customer_comment || '—'}
Итоговая сумма: ${new Intl.NumberFormat('ru-RU').format(order.total_price)} руб.
Статус: ${order.status || 'NEW'}
Дата: ${new Date().toLocaleString('ru-RU')}
---------------------------------------
Состав заказа:
${itemsText}
  `.trim();

  return await dispatchEmail({
    subject,
    text,
    data: {
      'Тип события': 'Новый заказ',
      'Номер заказа': order.order_number,
      'Клиент': order.customer_name,
      'Телефон': order.customer_phone,
      'Email клиента': order.customer_email || 'не указан',
      'Адрес доставки': order.customer_address || 'не указан',
      'Сумма заказа': `${new Intl.NumberFormat('ru-RU').format(order.total_price)} руб.`,
      'Состав заказа': itemsText
    },
    logMeta: {
      type: 'order',
      orderNumber: order.order_number,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      totalPrice: order.total_price
    }
  });
}

// Уведомление о новой заявке на консультацию или расчет
async function sendLeadNotification(lead) {
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

  return await dispatchEmail({
    subject,
    text,
    data: {
      'Тип события': 'Новая заявка на консультацию',
      'Имя клиента': lead.customer_name,
      'Телефон': lead.customer_phone,
      'Комментарий / Выбранный проект': lead.customer_comment || 'Заявка с сайта'
    },
    logMeta: {
      type: 'lead',
      customerName: lead.customer_name,
      customerPhone: lead.customer_phone
    }
  });
}

// Чтение лога исходящих уведомлений для отображения в админ-панели
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
  testSmtpConnection,
  getOutbox,
  getNotifySettings
};
