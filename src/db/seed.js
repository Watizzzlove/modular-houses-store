const db = require('./database');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

function runSeed() {
  console.log('--- Starting Database Seeding ---');

  // 1. Admin User
  const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@doka.local');
  if (!existingAdmin) {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (email, password_hash, role)
      VALUES (?, ?, ?)
    `).run('admin@doka.local', passwordHash, 'admin');
    console.log('[+] Admin created: admin@doka.local / admin123');
  }

  // 2. Categories
  const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name, slug, sort_order) VALUES (?, ?, ?)');
  insertCat.run('Модульные дома', 'houses', 1);
  insertCat.run('Модульные бани', 'saunas', 2);
  const houseCat = db.prepare('SELECT id FROM categories WHERE slug = ?').get('houses');
  const saunaCat = db.prepare('SELECT id FROM categories WHERE slug = ?').get('saunas');

  // 3. Series
  const insertSeries = db.prepare(`
    INSERT OR REPLACE INTO series (category_id, name, slug, tagline, description, base_price, cover_image, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  insertSeries.run(
    houseCat.id,
    'Алтай',
    'altai',
    'Просторный модульный дом с панорамным фасадом',
    'Лидер продаж. Идеален для постоянного проживания семьи. Высокие потолки, панорамные окна в пол, энергоэффективное утепление 200 мм.',
    3868000,
    '/houses/altai/9x9.5__p4259000/bronze/main.jpg',
    1
  );

  insertSeries.run(
    houseCat.id,
    'Таганай',
    'taganay',
    'Компактный эргономичный дом для круглогодичного проживания',
    'Современный скандинавский минимализм. Продуманное зонирование: кухня-гостиная, две спальни, санузел и тамбур.',
    2950000,
    '/houses/altai/9x9.5__p4259000/bronze/exterior_1.jpg',
    2
  );

  insertSeries.run(
    houseCat.id,
    'Тайга',
    'taiga',
    'Надежный дом с выразительной архитектурой',
    'Стильное сочетание дерева и металла в фасадных решениях. Оптимален для участков со сложным рельефом.',
    3450000,
    '/houses/altai/11.2x9.5__p5493000/bronze/main.jpg',
    3
  );

  insertSeries.run(
    houseCat.id,
    'Урал 2.0',
    'ural_2.0',
    'Флагманский дом с расширенной гостиной и террасой',
    'Максимальный комфорт для большой семьи. Панорамное остекление второго света и мастер-спальня с отдельным санузлом.',
    4120000,
    '/houses/altai/11x9.5__p5493000/bronze/main.jpg',
    4
  );

  // Saunas
  insertSeries.run(
    saunaCat.id,
    'Аркаим',
    'arkaim',
    'Стильная модульная баня с зоной отдыха',
    'Просторная комната отдыха, помывочная и парная с отделкой сибирской липой и кедром. Печь с закрытой каменкой.',
    1850000,
    '/houses/altai/9x9.5__p4259000/bronze/main.jpg',
    5
  );

  insertSeries.run(
    saunaCat.id,
    'Классика',
    'klassika',
    'Традиционная русская парная в модульном исполнении',
    'Классическая планировка: парная, мойка, раздевалка. Быстрый прогрев за 45 минут в любой мороз.',
    550000,
    '/saunas/klassika/2.3x4__p550000/bronze/main.jpg',
    6
  );

  insertSeries.run(
    saunaCat.id,
    'Урал',
    'ural',
    'Эргономичная баня с высокой теплоемкостью',
    'Компактная планировка с просторной парилкой и моечным отделением. Идеальный выбор для круглогодичного отдыха.',
    614000,
    '/saunas/ural/2.3x4__p614000/bronze/main.jpg',
    7
  );

  insertSeries.run(
    saunaCat.id,
    'Таганай',
    'sauna_taganay',
    'Компактная баня в современном стиле с панорамным фасадом',
    'Прекрасное сочетание стиля и компактности. Просторная парная и комната отдыха.',
    726000,
    '/saunas/taganay/2.3x5__p726000/graphite/main.jpg',
    8
  );

  insertSeries.run(
    saunaCat.id,
    'Таганай 2.0',
    'sauna_taganay_2.0',
    'Двухмодульная баня повышенного комфорта',
    'Широкая баня 4.6 метра с большой комнатой отдыха и панорамным остеклением.',
    1376000,
    '/saunas/taganay_2.0/4.6x5__p1376000/graphite/main.jpg',
    9
  );

  insertSeries.run(
    saunaCat.id,
    'Тайга',
    'sauna_taiga',
    'Надежная и теплая баня для сибирских морозов',
    'Утепленный модульный контур, дровяная печь, моечное отделение и парная.',
    669000,
    '/saunas/taiga/2.3x4__p669000/bronze/main.jpg',
    10
  );

  insertSeries.run(
    saunaCat.id,
    'Тайга 2.0',
    'sauna_taiga_2.0',
    'Просторный банный комплекс с террасой',
    'Двухмодульная планировка 4.6 метра для большой компании и комфортного круглогодичного отдыха.',
    996000,
    '/saunas/taiga_2.0/4.6x4__p996000/bronze/main.jpg',
    11
  );

  // 4. Parse configurations and media items from houses and saunas folders
  const insertConfig = db.prepare(`
    INSERT INTO configurations (series_id, key, label, width, length, area, price, folder_name, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertExtension = db.prepare(`
    INSERT INTO extensions (configuration_id, kind, terrace_type, key, label, price, width, length, area)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMedia = db.prepare(`
    INSERT INTO media_items (series_id, configuration_id, color, entrance_kind, terrace_type, kind, filename, url, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function indexSeriesFolder(seriesId, seriesSlug, seriesDirPath, basePath) {
    if (!fs.existsSync(seriesDirPath)) return;

    db.prepare('DELETE FROM configurations WHERE series_id = ?').run(seriesId);
    db.prepare('DELETE FROM media_items WHERE series_id = ?').run(seriesId);

    const entries = fs.readdirSync(seriesDirPath, { withFileTypes: true });
    let sortOrder = 1;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderName = entry.name;
      const match = folderName.match(/^(?:(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?))(?:__p(\d+))?$/i);
      if (!match) continue;

      const width = parseFloat(match[1]);
      const length = parseFloat(match[2]);
      const price = parseInt(match[3] || '3500000', 10);
      const key = `${width}x${length}`;
      const label = `${String(width).replace('.', ',')}×${String(length).replace('.', ',')}`;
      const area = Math.round(width * length * 10) / 10;

      const res = insertConfig.run(
        seriesId,
        key,
        label,
        width,
        length,
        area,
        price,
        folderName,
        sortOrder++
      );
      const configId = res.lastInsertRowid;

      // Add extensions
      insertExtension.run(configId, 'porch', null, 'porch', 'Крыльцо', 180000, 2, 3, 6);
      insertExtension.run(configId, 'terrace', 'covered', 'terrace_covered', 'Крытая терраса', 420000, 3, 9, 27);
      insertExtension.run(configId, 'terrace', 'open', 'terrace_open', 'Открытая терраса', 260000, 3, 9, 27);

      // Recursive scan of this config folder
      const configFolder = path.join(seriesDirPath, folderName);
      
      function scanConfigDir(currentDir, relParts) {
        const files = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const f of files) {
          if (f.isDirectory()) {
            scanConfigDir(path.join(currentDir, f.name), [...relParts, f.name]);
          } else if (/\.(jpe?g|png|webp)$/i.test(f.name)) {
            // Determine color from parts
            let color = 'bronze';
            if (relParts.includes('beige')) color = 'beige';
            else if (relParts.includes('graphite')) color = 'graphite';
            else if (relParts.includes('bronze')) color = 'bronze';

            let entrance = 'base';
            let terraceType = null;
            if (relParts.includes('porch')) {
              entrance = 'porch';
            } else if (relParts.includes('terrace')) {
              entrance = 'terrace';
              terraceType = relParts.includes('covered') ? 'covered' : (relParts.includes('open') ? 'open' : null);
            }

            let kind = 'exterior';
            let photoOrder = 5;
            if (f.name.startsWith('main')) { kind = 'exterior'; photoOrder = 0; }
            else if (f.name.startsWith('plan')) { kind = 'plan'; photoOrder = 20; }
            else if (f.name.startsWith('interior')) { kind = 'interior'; photoOrder = 10; }

            const relUrl = path.join(basePath, folderName, ...relParts, f.name).replace(/\\/g, '/');

            insertMedia.run(
              seriesId,
              configId,
              color,
              entrance,
              terraceType,
              kind,
              f.name,
              relUrl,
              photoOrder
            );
          }
        }
      }

      scanConfigDir(configFolder, []);
    }
  }

  // Index Houses
  const houseSeriesList = [
    { slug: 'altai', folder: 'altai' },
    { slug: 'taganay', folder: 'taganay' },
    { slug: 'taiga', folder: 'taiga' },
    { slug: 'ural_2.0', folder: 'ural_2.0' }
  ];
  for (const s of houseSeriesList) {
    const sRow = db.prepare('SELECT id FROM series WHERE slug = ?').get(s.slug);
    if (sRow) {
      const dirPath = path.join(__dirname, '../../houses', s.folder);
      indexSeriesFolder(sRow.id, s.slug, dirPath, '/houses/' + s.folder);
      console.log(`[+] Indexed house series ${s.slug} from ${dirPath}`);
    }
  }

  // Index Saunas
  const saunaSeriesList = [
    { slug: 'arkaim', folder: 'arkaim' },
    { slug: 'klassika', folder: 'klassika' },
    { slug: 'ural', folder: 'ural' },
    { slug: 'sauna_taganay', folder: 'taganay' },
    { slug: 'sauna_taganay_2.0', folder: 'taganay_2.0' },
    { slug: 'sauna_taiga', folder: 'taiga' },
    { slug: 'sauna_taiga_2.0', folder: 'taiga_2.0' }
  ];
  for (const s of saunaSeriesList) {
    const sRow = db.prepare('SELECT id FROM series WHERE slug = ?').get(s.slug);
    if (sRow) {
      const dirPath = path.join(__dirname, '../../saunas', s.folder);
      indexSeriesFolder(sRow.id, s.slug, dirPath, '/saunas/' + s.folder);
      console.log(`[+] Indexed sauna series ${s.slug} from ${dirPath}`);
    }
  }

  // 5. Popular Presets (Популярные комплектации)
  db.prepare('DELETE FROM popular_presets').run();
  const insertPreset = db.prepare(`
    INSERT INTO popular_presets (
      badge, title, series_slug, size_key, color, entrance, terrace_type, extension_key, price, area, dimensions, image_url, features_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertPreset.run(
    'ХИТ ПРОДАЖ',
    'Дом «Алтай» 9×9,5',
    'altai',
    '9x9.5',
    'bronze',
    'terrace',
    'covered',
    '3x9',
    4679000,
    '85,5 м²',
    '9,0 × 9,5 м',
    '/houses/altai/9x9.5__p4259000/bronze/main.jpg',
    JSON.stringify([
      '3 просторных жилых модуля',
      'Большая крытая терраса 27 м²',
      'Утепление 200 мм (зимний контур)',
      'Чистовая отделка деревом камерной сушки'
    ]),
    1
  );

  insertPreset.run(
    'ВЫБОР СЕМЬИ',
    'Дом «Алтай» 11,2×9,5',
    'altai',
    '11.2x9.5',
    'bronze',
    null,
    null,
    null,
    5493000,
    '106,4 м²',
    '11,2 × 9,5 м',
    '/houses/altai/11.2x9.5__p5493000/bronze/main.jpg',
    JSON.stringify([
      '4 модуля максимальной площади',
      'Кухня-гостиная 34 м² + 3 спальни',
      'Панорамное двухкамерное остекление',
      'Скрытая разводка электрики и сантехники'
    ]),
    2
  );

  insertPreset.run(
    'ОПТИМАЛЬНЫЙ СТАРТ',
    'Дом «Алтай» 9,4×7,5',
    'altai',
    '9.4x7.5',
    'bronze',
    'porch',
    null,
    '2x3',
    4048000,
    '70,5 м²',
    '9,4 × 7,5 м',
    '/houses/altai/9x9.5__p4259000/bronze/exterior_1.jpg',
    JSON.stringify([
      '2 модуля + входное крыльцо',
      'Энергоэффективный компактный дом',
      'Монтаж на свайный фундамент за 1 день',
      'Готов к круглогодичному заселению'
    ]),
    3
  );

  console.log('[+] Popular presets seeded');

  // 6. Site Content
  const insertContent = db.prepare('INSERT OR REPLACE INTO site_content (key, value) VALUES (?, ?)');
  insertContent.run('site_phone', '8 (800) 600-34-99');
  insertContent.run('site_phone_secondary', '8 (964) 570-10-85');
  insertContent.run('site_email', 'b2c@doka.pro');
  insertContent.run('hero_title', 'Модульные дома и бани заводского качества');
  insertContent.run('hero_subtitle', 'Производим теплые модульные дома и бани по ГОСТ. Доставка по всей России, установка и подключение на вашем участке за 1-2 дня без строительного мусора.');
  insertContent.run('telegram_link', 'https://t.me/Dokabani');
  insertContent.run('vk_link', 'https://vk.com/bani_stroitelstvo');
  insertContent.run('working_hours', 'Ежедневно с 9:00 до 20:00');
  insertContent.run('about_text', 'Мы специализируемся на проектировании и заводском производстве энергоэффективных модульных домов и бань. Вся сборка происходит в закрытых сухих цехах на высокоточном оборудовании, что исключает намокание утеплителя и человеческий фактор.');

  // 7. YooKassa Settings
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('yookassa_enabled', 'true');
  insertSetting.run('yookassa_shop_id', '');
  insertSetting.run('yookassa_secret_key', '');
  insertSetting.run('yookassa_test_mode', 'true');

  console.log('[+] Site content & settings seeded');
  console.log('--- Database Seeding Complete ---');
}

if (require.main === module) {
  runSeed();
}

module.exports = runSeed;
