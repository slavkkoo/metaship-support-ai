/**
 * FAQ BUILDER - Создание FAQ из реальных ответов поддержки
 *
 * 1. Находит частые вопросы по функционалу (не ошибки)
 * 2. Загружает полную историю переписки
 * 3. Извлекает пары вопрос-ответ для FAQ
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';

config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Omnidesk API config
const OMNIDESK_BASE = `https://${process.env.OMNIDESK_SUBDOMAIN || 'pimpay'}.omnidesk.ru/api`;
const AUTH_HEADER = `Basic ${Buffer.from(`${process.env.OMNIDESK_EMAIL}:${process.env.OMNIDESK_API_TOKEN}`).toString('base64')}`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════
// ПАТТЕРНЫ ВОПРОСОВ ПО ФУНКЦИОНАЛУ (не ошибки!)
// ═══════════════════════════════════════════════════════════════

const FUNCTIONALITY_PATTERNS = {
  // === API и интеграция ===
  'API: Создание заказа': {
    pattern: /как\s+(создать|оформить|сделать)\s+заказ|создание\s+заказ|можно\s+ли\s+создать|POST.*orders/i,
    exclude: /ошибк|error|500|не\s+создается|не\s+работает/i
  },
  'API: Многоместный заказ': {
    pattern: /многомест|несколько\s+мест|грузомест|place.*barcode|places\[/i,
    exclude: /ошибк|error/i
  },
  'API: Возврат заказа': {
    pattern: /как\s+(оформить|создать|сделать)\s+возврат|клиентский\s+возврат|легкий\s+возврат|returnItems/i,
    exclude: /ошибк|error|не\s+работает/i
  },
  'API: Редактирование заказа': {
    pattern: /как\s+(редактировать|изменить|отредактировать)|можно\s+ли\s+(редактировать|изменить)|PATCH.*orders/i,
    exclude: /ошибк|error/i
  },
  'API: Статусы заказа': {
    pattern: /какой\s+статус|как\s+получить\s+статус|значение\s+статуса|статус.*означает|GET.*orders.*status/i,
    exclude: /ошибк|error|не\s+приходит/i
  },
  'API: Офферы и тарифы': {
    pattern: /как\s+получить\s+(офферы?|тарифы?)|какие\s+тарифы|стоимость\s+доставки|GET.*offers|v2\/offers/i,
    exclude: /ошибк|error/i
  },
  'API: Удаление заказа': {
    pattern: /как\s+(удалить|отменить)\s+заказ|DELETE.*orders|отмена\s+заказа/i,
    exclude: /ошибк|error/i
  },
  'API: Webhook': {
    pattern: /как\s+настроить\s+webhook|формат\s+webhook|callback\s+url|пуш.*статус/i,
    exclude: /ошибк|error|не\s+приходит/i
  },
  'API: Авторизация': {
    pattern: /как\s+(авторизоваться|получить\s+токен)|формат\s+авторизации|api.*key|Bearer/i,
    exclude: /401|403|ошибк/i
  },

  // === Виджет ===
  'Виджет: Инициализация': {
    pattern: /как\s+настроить\s+виджет|параметры?\s+виджет|инициализация\s+виджет|setParameter|widgetKey/i,
    exclude: /ошибк|error|не\s+работает/i
  },
  'Виджет: Отображение ПВЗ': {
    pattern: /точки\s+на\s+карт|отображ.*пвз|фильтр.*виджет|deliveryTypes/i,
    exclude: /ошибк|error/i
  },

  // === Документы ===
  'Документы: Этикетки': {
    pattern: /как\s+(получить|распечатать|скачать)\s+этикетк|формат\s+этикетк|штрих.*код|ШК|label/i,
    exclude: /ошибк|error/i
  },
  'Документы: Партии и Ф103': {
    pattern: /как\s+(сформировать|создать)\s+партию?|ф103|накладная\s+партии|parcels.*acceptance/i,
    exclude: /ошибк|error/i
  },
  'Документы: Маркировка': {
    pattern: /как\s+(указать|передать)\s+маркировк|честный\s+знак|marking|items\.marking/i,
    exclude: /ошибк|error/i
  },

  // === Оплата ===
  'Оплата: Наложенный платеж': {
    pattern: /как\s+(указать|передать)\s+(наложенн|стоимость)|deliverySum|declaredValue|payment\.type|PayOnDelivery/i,
    exclude: /ошибк|error/i
  },
  'Оплата: НДС': {
    pattern: /ндс|vat|налог|items\.vat/i,
    exclude: /ошибк|error/i
  },

  // === Службы доставки ===
  'СД: СДЭК': {
    pattern: /сдэк|cdek|тариф.*136|тариф.*137|тариф.*368/i,
    exclude: /ошибк|error|500/i
  },
  'СД: 5Post': {
    pattern: /5post|5пост|пятёрочка|fivepost/i,
    exclude: /ошибк|error|500/i
  },
  'СД: Почта России': {
    pattern: /почта\s+росси|russian\s+post|посылка\s+онлайн|еком/i,
    exclude: /ошибк|error|500/i
  },
  'СД: ПЭК': {
    pattern: /пэк|pecom|сборный\s+груз/i,
    exclude: /ошибк|error|500/i
  },
  'СД: Dalli': {
    pattern: /dalli|далли/i,
    exclude: /ошибк|error|500/i
  },
  'СД: КСЭ': {
    pattern: /ксэ|cse|cargo/i,
    exclude: /ошибк|error|500/i
  },
  'СД: Яндекс Доставка': {
    pattern: /яндекс\s+доставк|yandex|МШ\s+СД\s+ЯД/i,
    exclude: /ошибк|error|500/i
  },

  // === ЛК и настройки ===
  'ЛК: Создание заказа': {
    pattern: /создать.*через\s+лк|в\s+лк\s+создать|личн.*кабинет.*заказ/i,
    exclude: /ошибк|error/i
  },
  'ЛК: Настройки магазина': {
    pattern: /настройк.*магазин|shop.*settings|подключен.*магазин|коннекшен/i,
    exclude: /ошибк|error/i
  },
  'ЛК: Склад': {
    pattern: /склад|warehouse|точка\s+сдачи|warehouseId/i,
    exclude: /ошибк|error/i
  },

  // === Интеграции ===
  'Интеграция: Битрикс': {
    pattern: /битрикс|bitrix|1с.*битрикс|модуль/i,
    exclude: /ошибк|error/i
  },

  // === Курьерская доставка ===
  'Курьерская доставка': {
    pattern: /курьер.*доставк|интервал.*доставк|доступные\s+интервалы|type.*Courier/i,
    exclude: /ошибк|error|некорректн/i
  },

  // === Частичный выкуп ===
  'Частичный выкуп': {
    pattern: /частичн.*выкуп|невыкуп|partial/i,
    exclude: /ошибк|error/i
  }
};

// ═══════════════════════════════════════════════════════════════
// АНАЛИЗ БД - ПОИСК ВОПРОСОВ ПО ФУНКЦИОНАЛУ
// ═══════════════════════════════════════════════════════════════

async function findFunctionalityQuestions() {
  console.log('═'.repeat(80));
  console.log('📊 ПОИСК ВОПРОСОВ ПО ФУНКЦИОНАЛУ');
  console.log('═'.repeat(80));

  // Загружаем все тикеты (максимум)
  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('ticket_id, subject, first_message_text, status, created_at')
    .order('created_at', { ascending: false })
    .limit(2000);

  if (!tickets || tickets.length === 0) {
    console.log('Нет данных в БД');
    return [];
  }

  console.log(`Загружено тикетов: ${tickets.length}`);

  const results = {};

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');

    for (const [category, { pattern, exclude }] of Object.entries(FUNCTIONALITY_PATTERNS)) {
      // Проверяем что это вопрос по функционалу, а не ошибка
      if (pattern.test(text) && !exclude.test(text)) {
        if (!results[category]) {
          results[category] = [];
        }
        // Берем только закрытые тикеты (там есть ответы)
        if (t.status === 'closed' && results[category].length < 30) {
          results[category].push({
            ticket_id: t.ticket_id,
            subject: t.subject,
            question: (t.first_message_text || '').substring(0, 300)
          });
        }
      }
    }
  }

  // Сортируем по количеству
  const sorted = Object.entries(results)
    .map(([cat, tickets]) => ({ category: cat, tickets, count: tickets.length }))
    .sort((a, b) => b.count - a.count);

  console.log('\nНайдено вопросов по категориям:');
  for (const { category, count } of sorted) {
    console.log(`  ${category}: ${count} тикетов`);
  }

  return sorted;
}

// ═══════════════════════════════════════════════════════════════
// ЗАГРУЗКА ПОЛНОЙ ИСТОРИИ ТИКЕТА
// ═══════════════════════════════════════════════════════════════

async function fetchTicketMessages(ticketId, retries = 3) {
  try {
    const response = await fetch(`${OMNIDESK_BASE}/cases/${ticketId}/messages.json`, {
      headers: {
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json'
      }
    });

    // Retry on rate limit
    if (response.status === 429 && retries > 0) {
      const waitTime = (4 - retries) * 3000; // 3s, 6s, 9s
      console.log(`  ⏳ Rate limit, ждём ${waitTime/1000}s...`);
      await sleep(waitTime);
      return fetchTicketMessages(ticketId, retries - 1);
    }

    if (!response.ok) {
      console.log(`  ⚠️ Не удалось загрузить #${ticketId}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Парсим формат Omnidesk
    let messages = [];
    if (Array.isArray(data)) {
      messages = data;
    } else if (typeof data === 'object') {
      const keys = Object.keys(data).filter(k => !isNaN(parseInt(k)));
      messages = keys.map(k => data[k]);
    }

    // Сортируем по времени
    return messages
      .map(m => m.message || m)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(m => ({
        from: m.user_id ? 'client' : 'support',
        staff_id: m.staff_id,
        content: m.content || m.content_text || m.text || '',
        created_at: m.created_at
      }));

  } catch (e) {
    console.log(`  ⚠️ Ошибка загрузки #${ticketId}: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// ИЗВЛЕЧЕНИЕ FAQ ИЗ ПЕРЕПИСКИ
// ═══════════════════════════════════════════════════════════════

function extractFAQFromMessages(ticketId, subject, messages) {
  if (!messages || messages.length < 2) return null;

  // Очищаем контент от HTML и лишних пробелов
  const cleanContent = (text) => {
    return (text || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Паттерны для "пустых" ответов, которые нужно пропустить
  const SKIP_PATTERNS = [
    /^(добрый день|привет),?\s*(запрос в работе|в работе|смотр[юи])/i,
    /^запрос в работе/i,
    /^в работе/i,
    /запрос\s+#\d+-\d+\s*$/i,
    /^(добрый день|привет),?\s*запрос\s+#\d+/i,
    /уточн.*пожалуйста/i,
    /пришлите.*пожалуйста.*пример/i,
    /не\s+совсем\s+понят(ен|но)\s+вопрос/i
  ];

  // Проверка что ответ содержательный
  const isGoodAnswer = (text) => {
    const cleaned = cleanContent(text);
    if (cleaned.length < 100) return false;

    for (const pattern of SKIP_PATTERNS) {
      if (pattern.test(cleaned)) return false;
    }

    // Должен содержать полезную информацию
    const hasUsefulContent = /метод|api|параметр|поле|значени|настройк|указ|передать|использ|формат|пример|можно|нужно|необходимо|требуется|https?:\/\//i.test(cleaned);
    return hasUsefulContent;
  };

  // Ищем первое сообщение клиента (вопрос)
  const clientMessage = messages.find(m => m.from === 'client');
  if (!clientMessage) return null;

  // Ищем содержательный ответ поддержки (не просто "в работе")
  const supportMessages = messages.filter(m => m.from === 'support');
  const goodAnswer = supportMessages.find(m => isGoodAnswer(m.content));

  if (!goodAnswer) return null;

  const question = cleanContent(clientMessage.content);
  const answer = cleanContent(goodAnswer.content);

  // Проверяем качество вопроса
  if (question.length < 20) return null;

  return {
    ticket_id: ticketId,
    subject: subject,
    question: question.substring(0, 500),
    answer: answer.substring(0, 2000),
    full_messages: messages.length
  };
}

// ═══════════════════════════════════════════════════════════════
// ГЛАВНАЯ ФУНКЦИЯ
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' FAQ BUILDER — СОЗДАНИЕ FAQ ИЗ РЕАЛЬНЫХ ОТВЕТОВ'.padStart(52).padEnd(78) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  // 1. Находим вопросы по функционалу
  const categories = await findFunctionalityQuestions();

  if (categories.length === 0) {
    console.log('Не найдено вопросов по функционалу');
    return;
  }

  // 2. Загружаем полную историю для топ-категорий
  console.log('\n' + '═'.repeat(80));
  console.log('📥 ЗАГРУЗКА ПОЛНОЙ ИСТОРИИ ТИКЕТОВ');
  console.log('═'.repeat(80));

  const faqByCategory = {};
  let totalLoaded = 0;

  for (const { category, tickets } of categories.slice(0, 25)) { // Топ-25 категорий
    console.log(`\n📁 ${category} (${tickets.length} тикетов)`);
    faqByCategory[category] = [];

    for (const ticket of tickets.slice(0, 15)) { // До 15 тикетов на категорию
      console.log(`  Загружаю #${ticket.ticket_id}...`);

      const messages = await fetchTicketMessages(ticket.ticket_id);

      if (messages) {
        const faq = extractFAQFromMessages(ticket.ticket_id, ticket.subject, messages);
        if (faq) {
          faqByCategory[category].push(faq);
          totalLoaded++;
          console.log(`    ✓ Извлечено Q&A (${messages.length} сообщений)`);
        } else {
          console.log(`    ✗ Не удалось извлечь Q&A`);
        }
      }

      await sleep(500); // Rate limiting - increased to avoid 429
    }
  }

  // 3. Формируем итоговый FAQ
  console.log('\n' + '═'.repeat(80));
  console.log('📝 ФОРМИРОВАНИЕ FAQ');
  console.log('═'.repeat(80));

  let faqContent = `# FAQ MetaShip — Вопросы по функционалу

> Создано автоматически на основе ${totalLoaded} реальных ответов поддержки
> Дата: ${new Date().toISOString().split('T')[0]}

---

`;

  for (const [category, faqs] of Object.entries(faqByCategory)) {
    if (faqs.length === 0) continue;

    faqContent += `## ${category}\n\n`;

    for (const faq of faqs) {
      faqContent += `### Вопрос (тикет #${faq.ticket_id})\n`;
      faqContent += `> ${faq.question}\n\n`;
      faqContent += `**Ответ:**\n${faq.answer}\n\n`;
      faqContent += `---\n\n`;
    }
  }

  // 4. Сохраняем
  const outputPath = '/Users/blinovvaceslav/Desktop/_Projects/Ticket/Support_AI_Research/FAQ_GENERATED.md';
  writeFileSync(outputPath, faqContent);

  console.log(`\n✅ FAQ сохранен: ${outputPath}`);
  console.log(`   Всего Q&A пар: ${totalLoaded}`);

  // 5. Также сохраняем в JSON для обработки
  const jsonPath = '/Users/blinovvaceslav/Desktop/_Projects/Ticket/Support_AI_Research/faq-data.json';
  writeFileSync(jsonPath, JSON.stringify(faqByCategory, null, 2));
  console.log(`   JSON данные: ${jsonPath}`);
}

main().catch(console.error);
