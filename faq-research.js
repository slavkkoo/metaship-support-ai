/**
 * FAQ RESEARCH - Анализ частых вопросов и ошибок
 * Для построения базы знаний AI-агента поддержки
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync } from 'fs';

config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ═══════════════════════════════════════════════════════════════
// КАТЕГОРИИ ВОПРОСОВ И ПРОБЛЕМ
// ═══════════════════════════════════════════════════════════════

const CATEGORIES = {
  // API и интеграция
  'API: Создание заказа': /создан.*заказ|order.*creat|POST.*orders|не.*созда.*заказ/i,
  'API: Получение офферов': /оффер|offer|GET.*offers|тариф.*недоступ|пустой.*список/i,
  'API: Статусы заказа': /статус.*заказ|GET.*orders|трекинг|tracking|status/i,
  'API: Удаление заказа': /удал.*заказ|delete.*order|отмен.*заказ/i,
  'API: Редактирование': /редактир|edit.*order|изменить.*заказ|PATCH/i,
  'API: Партии': /парти|parcel|batch|формирован.*партии/i,
  'API: Webhook': /webhook|вебхук|callback|пуш.*статус/i,
  'API: Авторизация': /401|403|auth|токен|token|unauthorized|доступ.*запрещ/i,

  // Виджет
  'Виджет: Инициализация': /виджет.*инициализ|widget.*init|setParameter/i,
  'Виджет: Отображение ПВЗ': /виджет.*пвз|точки.*карт|отображ.*точ|фильтр.*виджет/i,
  'Виджет: Настройка': /настро.*виджет|widget.*config|deliveryTypes|availableFilters/i,

  // Службы доставки
  'СД: СДЭК': /сдек|cdek/i,
  'СД: 5Post': /5post|5пост|пятёрочка/i,
  'СД: Почта России': /почта.*росси|russian.*post|посылка.*онлайн/i,
  'СД: Dalli': /dalli|далли/i,
  'СД: DPD': /dpd|дпд/i,
  'СД: Boxberry': /boxberry|боксберри/i,
  'СД: ПЭК': /пэк|pek/i,
  'СД: КСЭ': /ксэ|cse|cargo/i,
  'СД: Яндекс': /яндекс.*доставк|yandex/i,

  // Типы заказов
  'Заказ: Многоместный': /многомест|multi.*place|несколько.*мест|грузомест/i,
  'Заказ: Курьерский': /курьер.*доставк|courier|type.*courier/i,
  'Заказ: Возврат': /возврат|return|легкий.*возврат|клиентский.*возврат/i,
  'Заказ: Частичный выкуп': /частичн.*выкуп|partial.*sale|невыкуп/i,

  // Документы и этикетки
  'Документы: Этикетка': /этикетк|label|печать.*этикетк|ШК|штрих.*код/i,
  'Документы: Накладная': /накладн|Ф103|f103|партия/i,
  'Документы: Маркировка': /маркировк|marking|честный.*знак/i,

  // Оплата и тарифы
  'Оплата: НДС': /ндс|vat|налог/i,
  'Оплата: Наложенный платёж': /наложенн.*плат|PayOnDelivery|declaredValue|deliverySum/i,
  'Оплата: Стоимость доставки': /стоимость.*доставк|delivery.*sum|billing.*tariff/i,

  // Ошибки
  'Ошибка: Timeout/5xx': /timeout|500|502|503|504|server.*error/i,
  'Ошибка: Валидация': /валидац|validation|недопустим.*значен|некорректн/i,
  'Ошибка: ПВЗ не найден': /пвз.*не.*найден|точка.*не.*найден|deliveryPoint.*not/i,
  'Ошибка: Интервал доставки': /интервал.*доставк|delivery.*interval|некорректн.*интервал/i,

  // ЛК и настройки
  'ЛК: Создание заказа': /ЛК.*созда|личн.*кабинет.*заказ|создать.*ЛК/i,
  'ЛК: Настройки магазина': /настройк.*магазин|shop.*settings|подключен/i,
  'ЛК: Склад': /склад|warehouse|точка.*сдачи/i,

  // Интеграции
  'Интеграция: Битрикс': /битрикс|bitrix|1с.*битрикс|модуль/i,
  'Интеграция: InSales': /insales/i,
  'Интеграция: Тильда': /тильд|tilda/i,
};

// ═══════════════════════════════════════════════════════════════
// АНАЛИЗ БД SUPABASE
// ═══════════════════════════════════════════════════════════════

async function analyzeSupabase() {
  console.log('\n' + '═'.repeat(80));
  console.log('📊 АНАЛИЗ БД SUPABASE (последние 500 тикетов)');
  console.log('═'.repeat(80));

  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('ticket_id, subject, first_message_text, status, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (!tickets || tickets.length === 0) {
    console.log('Нет данных в БД');
    return {};
  }

  console.log(`Загружено тикетов: ${tickets.length}`);

  const categoryStats = {};

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');

    for (const [category, pattern] of Object.entries(CATEGORIES)) {
      if (pattern.test(text)) {
        if (!categoryStats[category]) {
          categoryStats[category] = { count: 0, examples: [] };
        }
        categoryStats[category].count++;
        if (categoryStats[category].examples.length < 3) {
          categoryStats[category].examples.push({
            id: t.ticket_id,
            subject: (t.subject || '').substring(0, 60)
          });
        }
      }
    }
  }

  return categoryStats;
}

// ═══════════════════════════════════════════════════════════════
// АНАЛИЗ АРХИВА ТИКЕТОВ
// ═══════════════════════════════════════════════════════════════

function analyzeArchive() {
  console.log('\n' + '═'.repeat(80));
  console.log('📁 АНАЛИЗ АРХИВА ТИКЕТОВ');
  console.log('═'.repeat(80));

  const archivePath = '/Users/blinovvaceslav/Desktop/MetaShip_Tutor/Тикеты суппорта РАГ/all_cases_2025_1.txt';

  let content;
  try {
    content = readFileSync(archivePath, 'utf-8');
  } catch (e) {
    console.log('Не удалось прочитать архив:', e.message);
    return {};
  }

  // Разбиваем на отдельные кейсы
  const cases = content.split(/\[CASE \d+\]/).filter(c => c.trim());
  console.log(`Найдено кейсов в архиве: ${cases.length}`);

  const categoryStats = {};

  for (const caseText of cases) {
    for (const [category, pattern] of Object.entries(CATEGORIES)) {
      if (pattern.test(caseText)) {
        if (!categoryStats[category]) {
          categoryStats[category] = { count: 0 };
        }
        categoryStats[category].count++;
      }
    }
  }

  return categoryStats;
}

// ═══════════════════════════════════════════════════════════════
// АНАЛИЗ РАЗМЕЧЕННЫХ Q&A
// ═══════════════════════════════════════════════════════════════

function analyzeQA() {
  console.log('\n' + '═'.repeat(80));
  console.log('📝 АНАЛИЗ РАЗМЕЧЕННЫХ Q&A');
  console.log('═'.repeat(80));

  const qaPath = '/Users/blinovvaceslav/Desktop/MetaShip_Tutor/Разметка для обучения - Лист1.csv';

  let content;
  try {
    content = readFileSync(qaPath, 'utf-8');
  } catch (e) {
    console.log('Не удалось прочитать CSV:', e.message);
    return [];
  }

  // Простой парсинг CSV
  const lines = content.split('\n').filter(l => l.trim());
  const qa = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Находим первую запятую вне кавычек
    let inQuotes = false;
    let splitIndex = -1;

    for (let j = 0; j < line.length; j++) {
      if (line[j] === '"') inQuotes = !inQuotes;
      if (line[j] === ',' && !inQuotes) {
        splitIndex = j;
        break;
      }
    }

    if (splitIndex > 0) {
      let question = line.substring(0, splitIndex).replace(/^"|"$/g, '').trim();
      let answer = line.substring(splitIndex + 1).replace(/^"|"$/g, '').trim();

      if (question && answer) {
        // Категоризируем вопрос
        let category = 'Общее';
        for (const [cat, pattern] of Object.entries(CATEGORIES)) {
          if (pattern.test(question + ' ' + answer)) {
            category = cat;
            break;
          }
        }

        qa.push({ question: question.substring(0, 100), answer: answer.substring(0, 200), category });
      }
    }
  }

  console.log(`Найдено Q&A пар: ${qa.length}`);
  return qa;
}

// ═══════════════════════════════════════════════════════════════
// ГЛАВНЫЙ ОТЧЁТ
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' FAQ RESEARCH — АНАЛИЗ ДЛЯ AI-АГЕНТА ПОДДЕРЖКИ'.padStart(52).padEnd(78) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  // 1. Анализ БД
  const dbStats = await analyzeSupabase();

  // 2. Анализ архива
  const archiveStats = analyzeArchive();

  // 3. Анализ Q&A
  const qaList = analyzeQA();

  // ═══════════════════════════════════════════════════════════════
  // ОБЪЕДИНЁННАЯ СТАТИСТИКА
  // ═══════════════════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(80));
  console.log('📈 ОБЪЕДИНЁННАЯ СТАТИСТИКА ПО КАТЕГОРИЯМ');
  console.log('═'.repeat(80));

  const combined = {};

  for (const [cat, data] of Object.entries(dbStats)) {
    combined[cat] = { db: data.count, archive: 0, qa: 0, examples: data.examples };
  }

  for (const [cat, data] of Object.entries(archiveStats)) {
    if (!combined[cat]) combined[cat] = { db: 0, archive: 0, qa: 0, examples: [] };
    combined[cat].archive = data.count;
  }

  for (const qa of qaList) {
    if (!combined[qa.category]) combined[qa.category] = { db: 0, archive: 0, qa: 0, examples: [] };
    combined[qa.category].qa++;
  }

  // Сортируем по общему количеству
  const sorted = Object.entries(combined)
    .map(([cat, data]) => ({
      category: cat,
      total: data.db + data.archive + data.qa,
      ...data
    }))
    .sort((a, b) => b.total - a.total);

  console.log('\nКатегория'.padEnd(35) + 'БД'.padStart(6) + 'Архив'.padStart(8) + 'Q&A'.padStart(6) + 'Всего'.padStart(8));
  console.log('─'.repeat(80));

  for (const item of sorted) {
    if (item.total > 0) {
      console.log(
        item.category.padEnd(35) +
        item.db.toString().padStart(6) +
        item.archive.toString().padStart(8) +
        item.qa.toString().padStart(6) +
        item.total.toString().padStart(8)
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ТОП ПРОБЛЕМ ДЛЯ FAQ
  // ═══════════════════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(80));
  console.log('🔥 ТОП-15 КАТЕГОРИЙ ДЛЯ FAQ (приоритет для AI-агента)');
  console.log('═'.repeat(80));

  sorted.slice(0, 15).forEach((item, i) => {
    const bar = '█'.repeat(Math.min(Math.round(item.total / 5), 20));
    console.log(`${(i + 1).toString().padStart(2)}. ${item.category.padEnd(35)} ${item.total.toString().padStart(4)} ${bar}`);
  });

  // ═══════════════════════════════════════════════════════════════
  // ГОТОВЫЕ Q&A ПО КАТЕГОРИЯМ
  // ═══════════════════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(80));
  console.log('📚 ГОТОВЫЕ Q&A ДЛЯ ОБУЧЕНИЯ (по категориям)');
  console.log('═'.repeat(80));

  const qaByCat = {};
  for (const qa of qaList) {
    if (!qaByCat[qa.category]) qaByCat[qa.category] = [];
    qaByCat[qa.category].push(qa);
  }

  for (const [cat, items] of Object.entries(qaByCat).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n📁 ${cat} (${items.length} Q&A)`);
    items.slice(0, 3).forEach(qa => {
      console.log(`   Q: ${qa.question}...`);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // РЕКОМЕНДАЦИИ
  // ═══════════════════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(80));
  console.log('💡 РЕКОМЕНДАЦИИ ДЛЯ AI-АГЕНТА ПОДДЕРЖКИ');
  console.log('═'.repeat(80));

  console.log(`
1. ПРИОРИТЕТНЫЕ КАТЕГОРИИ ДЛЯ FAQ:
   - API: Создание заказа (самая частая проблема)
   - Виджет: Инициализация и отображение ПВЗ
   - СД: СДЭК, 5Post, Почта России (топ по обращениям)
   - Ошибки: Валидация, ПВЗ не найден, Timeout

2. ГОТОВАЯ БАЗА ЗНАНИЙ:
   - ${qaList.length} размеченных Q&A пар готовы к использованию
   - Основные темы: создание заказов, виджет, тарифы, возвраты

3. ИСТОЧНИКИ ДЛЯ ОБУЧЕНИЯ:
   - CSV: /MetaShip_Tutor/Разметка для обучения - Лист1.csv
   - Архив: /MetaShip_Tutor/Тикеты суппорта РАГ/
   - БД Supabase: support_tickets

4. СТРУКТУРА FAQ ДЛЯ АГЕНТА:
   - API и интеграция (методы, ошибки, примеры)
   - Виджет MetaShip (настройка, параметры)
   - Службы доставки (особенности каждой СД)
   - Типы заказов (многоместные, возвраты, курьерские)
   - Документы (этикетки, маркировка)
   - Частые ошибки и их решения
`);

  console.log('═'.repeat(80));
  console.log('КОНЕЦ ОТЧЁТА');
  console.log('═'.repeat(80));
}

main().catch(console.error);
