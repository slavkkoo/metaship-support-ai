/**
 * АНАЛИТИКА ПО КЛИЕНТАМ ЗА ПОСЛЕДНЮЮ НЕДЕЛЮ
 * Показывает кто чаще всего обращается и с какими проблемами
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ═══════════════════════════════════════════════════════════════
// ПАТТЕРНЫ ДЛЯ ОПРЕДЕЛЕНИЯ КЛИЕНТОВ
// ═══════════════════════════════════════════════════════════════

const CLIENT_PATTERNS = [
  // Крупные клиенты / интеграторы
  [/валта/i, 'ВАЛТА'],
  [/кма|kma(?!\w)/i, 'КМА'],
  [/лаки[-\s]?сд|лаки(?![\wа-яё])/i, 'Лаки'],
  [/intercosmetology|интеркосметолог/i, 'Intercosmetology'],
  [/citilink|ситилинк/i, 'Citilink'],
  [/майдент|mydent|мойдент/i, 'МайДент24'],
  [/insales/i, 'InSales'],
  [/tom\s*tailor/i, 'Tom Tailor'],
  [/петрович(?![\wа-яё])/i, 'Петрович'],
  [/смарт\s*дс/i, 'Смарт ДС Рус'],
  [/улыбка\s*радуги/i, 'Улыбка Радуги'],
  [/псб\s*маркет/i, 'ПСБ Маркет'],
  [/веллтекс|welltex/i, 'Веллтекс'],
  [/органик\s*смарт/i, 'Органик Смарт'],
  [/связон/i, 'Связон'],

  // PIM интеграции
  [/pim[\.\s-]*агрегац|pim\.агрегац/i, 'PIM.Агрегация'],
  [/пим[-\s]*ям|pim[-\s]*ям/i, 'PIM-ЯМ'],

  // Маркетплейсы
  [/яндекс[\.\s]*маркет/i, 'Яндекс.Маркет'],
  [/ozon|озон(?![\wа-яё])/i, 'Ozon'],
  [/wildberries|вайлдберриз|wb(?!\w)/i, 'Wildberries'],
  [/lamoda|ламода/i, 'Lamoda'],
  [/мегамаркет/i, 'МегаМаркет'],
  [/сбермаркет|сбер\s*маркет/i, 'СберМаркет'],

  // Платформы / CMS
  [/bitrix|битрикс/i, 'Bitrix'],
  [/1с[-\s]?битрикс/i, '1С-Битрикс'],
  [/тильд[аеу]/i, 'Тильда'],

  // Прочие
  [/посылка.*субагрегатор|красота.*посылка/i, 'Посылка (Красота)'],
  [/семена\s*тут/i, 'Семена тут'],
  [/спвк/i, 'СПВК'],
];

// ИП с уникальными фамилиями (из истории тикетов)
const KNOWN_IP = [
  [/ип\s*ладная|ладная\s*лидия/i, 'ИП Ладная Лидия'],
  [/ип\s*алискеров/i, 'ИП Алискерова'],
  [/ип\s*амирасланов/i, 'ИП Амирасланов'],
  [/ип\s*семенов/i, 'ИП Семенов'],
];

// ═══════════════════════════════════════════════════════════════
// ПАТТЕРНЫ ДЛЯ СЛУЖБ ДОСТАВКИ
// ═══════════════════════════════════════════════════════════════

const DS_PATTERNS = [
  [/сдек|cdek/i, 'СДЕК'],
  [/dalli|далли/i, 'Dalli'],
  [/почта\s*росси|ems(?!\w)/i, 'Почта России'],
  [/dpd|дпд/i, 'DPD'],
  [/5post|5пост|пятёрочка/i, '5Post'],
  [/boxberry|боксберри/i, 'Boxberry'],
  [/яндекс.*доставк|яндекс\s*го/i, 'Яндекс Доставка'],
  [/пэк(?!\w)/i, 'ПЭК'],
  [/деловые\s*линии/i, 'Деловые Линии'],
];

// ═══════════════════════════════════════════════════════════════
// ПАТТЕРНЫ ПРОБЛЕМ
// ═══════════════════════════════════════════════════════════════

const PROBLEM_PATTERNS = {
  'Создание заказа': /ошибк.*созда|не.*созда|order.*error|failed.*create|не\s*получается\s*созда/i,
  'ПВЗ не найден': /пвз.*не\s*найден|точка.*не\s*найден|pickup.*not|deliveryPoint.*not/i,
  'Интервал доставки': /интервал|interval|некорректн.*интервал|время.*доставк/i,
  'Тариф недоступен': /тариф.*недоступ|тариф.*не\s*найден|tariff.*not|пустой.*список.*offer|оффер.*пуст/i,
  'Статусы не обновляются': /статус.*не.*обновл|не.*приход.*статус|sync.*status/i,
  'Webhook': /webhook|вебхук|callback.*не.*работ/i,
  'Этикетка/Накладная': /этикетк|накладн|label|print.*error/i,
  'Возврат': /возврат|return|отмен.*заказ/i,
  'Модуль/Виджет': /модуль|виджет|plugin|плагин|подключени/i,
  'Авторизация': /401|403|auth.*error|unauthorized|доступ.*запрещ|токен/i,
  'Timeout/5xx': /timeout|500|502|503|504|server.*error/i,
  'API вопрос': /api|апи|endpoint|запрос|интеграц/i,
  'Склад': /склад|warehouse|забор|pickup/i,
  'Трекинг': /трек|track|отслежив/i,
};

// ═══════════════════════════════════════════════════════════════
// ФУНКЦИИ ИЗВЛЕЧЕНИЯ
// ═══════════════════════════════════════════════════════════════

function extractClient(text) {
  if (!text) return null;

  // Сначала проверяем известных клиентов
  for (const [pattern, name] of CLIENT_PATTERNS) {
    if (pattern.test(text)) return name;
  }

  // Затем известных ИП
  for (const [pattern, name] of KNOWN_IP) {
    if (pattern.test(text)) return name;
  }

  // Ищем ИП + ФИО (общий паттерн)
  const ip = text.match(/ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?/);
  if (ip) return ip[0];

  // Ищем ООО
  const ooo = text.match(/ООО\s*[«"]?([А-ЯЁа-яё0-9\s\-]+)/);
  if (ooo) return ooo[0].replace(/[«»"]/g, '').trim().substring(0, 30);

  return null;
}

function extractDS(text) {
  if (!text) return [];
  const result = [];
  for (const [pattern, name] of DS_PATTERNS) {
    if (pattern.test(text)) result.push(name);
  }
  return result;
}

function extractProblems(text) {
  if (!text) return [];
  const result = [];
  for (const [name, pattern] of Object.entries(PROBLEM_PATTERNS)) {
    if (pattern.test(text)) result.push(name);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════════════

function getWeekRange(weeksAgo = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - diffToMonday);
  thisMonday.setHours(0, 0, 0, 0);

  const targetMonday = new Date(thisMonday);
  targetMonday.setDate(thisMonday.getDate() - 7 * weeksAgo);

  const targetSunday = new Date(targetMonday);
  targetSunday.setDate(targetMonday.getDate() + 6);
  targetSunday.setHours(23, 59, 59, 999);

  return { start: targetMonday, end: targetSunday };
}

function formatDate(d) {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// ═══════════════════════════════════════════════════════════════
// ОСНОВНОЙ ОТЧЁТ
// ═══════════════════════════════════════════════════════════════

async function main() {
  const lastWeek = getWeekRange(1);
  const prevWeek = getWeekRange(2);

  // Загружаем тикеты
  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('*')
    .gte('created_at', lastWeek.start.toISOString())
    .lte('created_at', lastWeek.end.toISOString())
    .order('created_at', { ascending: false });

  const { data: prevTickets } = await supabase
    .from('support_tickets')
    .select('ticket_id, subject, first_message_text, status')
    .gte('created_at', prevWeek.start.toISOString())
    .lte('created_at', prevWeek.end.toISOString());

  // Заголовок отчёта
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' АНАЛИТИКА ПО КЛИЕНТАМ — ПРОШЛАЯ НЕДЕЛЯ'.padStart(52).padEnd(78) + '║');
  console.log('║' + ` ${formatDate(lastWeek.start)} — ${formatDate(lastWeek.end)}`.padStart(52).padEnd(78) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  console.log(`\nВсего тикетов: ${tickets.length} (пред. неделя: ${prevTickets?.length || 0})`);
  const closed = tickets.filter(t => t.status === 'closed').length;
  console.log(`Закрыто: ${closed} (${Math.round(closed / tickets.length * 100)}%)`);

  // ═══════════════════════════════════════════════════════════════
  // СБОР СТАТИСТИКИ ПО КЛИЕНТАМ
  // ═══════════════════════════════════════════════════════════════

  const clientStats = {};

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');
    const client = extractClient(text) || t.company_name || 'Не определён';

    if (!clientStats[client]) {
      clientStats[client] = {
        total: 0,
        open: 0,
        closed: 0,
        problems: {},
        ds: {},
        tickets: []
      };
    }

    const stats = clientStats[client];
    stats.total++;
    if (t.status === 'closed') stats.closed++;
    else stats.open++;

    // Проблемы
    for (const prob of extractProblems(text)) {
      stats.problems[prob] = (stats.problems[prob] || 0) + 1;
    }

    // Службы доставки
    for (const ds of extractDS(text)) {
      stats.ds[ds] = (stats.ds[ds] || 0) + 1;
    }

    // Сохраняем тикет
    stats.tickets.push({
      id: t.ticket_id,
      status: t.status,
      subject: (t.subject || '').substring(0, 55),
      problems: extractProblems(text),
      ds: extractDS(text)
    });
  }

  // Сортируем по количеству тикетов
  const sortedClients = Object.entries(clientStats)
    .filter(([name]) => name !== 'Не определён')
    .sort((a, b) => b[1].total - a[1].total);

  const unknownCount = clientStats['Не определён']?.total || 0;
  const identifiedCount = tickets.length - unknownCount;

  // ═══════════════════════════════════════════════════════════════
  // ВЫВОД СТАТИСТИКИ
  // ═══════════════════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(80));
  console.log('👥 КЛИЕНТЫ ПО КОЛИЧЕСТВУ ОБРАЩЕНИЙ');
  console.log('═'.repeat(80));
  console.log(`Идентифицировано: ${identifiedCount} из ${tickets.length} тикетов (${Math.round(identifiedCount / tickets.length * 100)}%)`);
  console.log();

  // Визуализация топ клиентов
  console.log('ТОП-15 КЛИЕНТОВ:');
  console.log('-'.repeat(80));

  sortedClients.slice(0, 15).forEach(([client, data], i) => {
    const bar = '█'.repeat(Math.min(data.total * 2, 20));
    const openMark = data.open > 0 ? ` ⚠️ ${data.open} открыто` : '';
    console.log(`${(i + 1).toString().padStart(2)}. ${client.padEnd(28)} ${data.total.toString().padStart(2)} ${bar}${openMark}`);
  });

  // ═══════════════════════════════════════════════════════════════
  // ДЕТАЛЬНЫЙ АНАЛИЗ ПО КЛИЕНТАМ
  // ═══════════════════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(80));
  console.log('📊 ДЕТАЛЬНЫЙ АНАЛИЗ ПО КЛИЕНТАМ');
  console.log('═'.repeat(80));

  sortedClients.slice(0, 10).forEach(([client, data]) => {
    console.log(`\n🏢 ${client}`);
    console.log('─'.repeat(60));
    console.log(`   Всего тикетов: ${data.total} (закрыто: ${data.closed}, открыто: ${data.open})`);

    // Топ проблемы
    const topProblems = Object.entries(data.problems)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (topProblems.length > 0) {
      console.log('   Проблемы:', topProblems.map(([p, c]) => `${p} (${c})`).join(', '));
    }

    // СД
    const topDS = Object.entries(data.ds)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (topDS.length > 0) {
      console.log('   СД:', topDS.map(([d, c]) => `${d} (${c})`).join(', '));
    }

    // Открытые тикеты
    const openTickets = data.tickets.filter(t => t.status !== 'closed');
    if (openTickets.length > 0) {
      console.log('   Открытые тикеты:');
      openTickets.forEach(t => {
        console.log(`      🔴 #${t.id}: ${t.subject}`);
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // ПРОБЛЕМЫ ПО ВСЕМ КЛИЕНТАМ
  // ═══════════════════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(80));
  console.log('🔧 ТИПЫ ПРОБЛЕМ (все идентифицированные клиенты)');
  console.log('═'.repeat(80));

  const allProblems = {};
  sortedClients.forEach(([client, data]) => {
    Object.entries(data.problems).forEach(([prob, count]) => {
      if (!allProblems[prob]) allProblems[prob] = { total: 0, clients: [] };
      allProblems[prob].total += count;
      allProblems[prob].clients.push({ client, count });
    });
  });

  Object.entries(allProblems)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([prob, data]) => {
      const topClients = data.clients
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map(c => c.client)
        .join(', ');
      console.log(`\n• ${prob}: ${data.total} тикетов`);
      console.log(`  Клиенты: ${topClients}`);
    });

  // ═══════════════════════════════════════════════════════════════
  // СЛУЖБЫ ДОСТАВКИ ПО КЛИЕНТАМ
  // ═══════════════════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(80));
  console.log('🚚 СЛУЖБЫ ДОСТАВКИ ПО КЛИЕНТАМ');
  console.log('═'.repeat(80));

  const allDS = {};
  sortedClients.forEach(([client, data]) => {
    Object.entries(data.ds).forEach(([ds, count]) => {
      if (!allDS[ds]) allDS[ds] = { total: 0, clients: [] };
      allDS[ds].total += count;
      allDS[ds].clients.push({ client, count });
    });
  });

  Object.entries(allDS)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([ds, data]) => {
      const topClients = data.clients
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map(c => `${c.client} (${c.count})`)
        .join(', ');
      console.log(`\n📦 ${ds}: ${data.total} тикетов`);
      console.log(`   Клиенты: ${topClients}`);
    });

  // ═══════════════════════════════════════════════════════════════
  // СВОДНАЯ ТАБЛИЦА
  // ═══════════════════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(80));
  console.log('📋 СВОДНАЯ ТАБЛИЦА');
  console.log('═'.repeat(80));
  console.log('Клиент'.padEnd(25) + 'Тикетов'.padStart(8) + 'Открыто'.padStart(8) + '  Главная проблема');
  console.log('─'.repeat(80));

  sortedClients.forEach(([client, data]) => {
    const topProblem = Object.entries(data.problems).sort((a, b) => b[1] - a[1])[0];
    const probStr = topProblem ? `${topProblem[0]} (${topProblem[1]})` : '—';

    console.log(
      client.substring(0, 24).padEnd(25) +
      data.total.toString().padStart(8) +
      data.open.toString().padStart(8) +
      '  ' + probStr
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // КЛИЕНТЫ С ОТКРЫТЫМИ ТИКЕТАМИ (ТРЕБУЮТ ВНИМАНИЯ)
  // ═══════════════════════════════════════════════════════════════

  const clientsWithOpen = sortedClients.filter(([_, d]) => d.open > 0);
  if (clientsWithOpen.length > 0) {
    console.log('\n' + '═'.repeat(80));
    console.log('⚠️  КЛИЕНТЫ С ОТКРЫТЫМИ ТИКЕТАМИ');
    console.log('═'.repeat(80));

    clientsWithOpen.forEach(([client, data]) => {
      console.log(`\n${client}: ${data.open} открытых`);
      data.tickets.filter(t => t.status !== 'closed').forEach(t => {
        console.log(`   #${t.id}: ${t.subject}`);
      });
    });
  }

  console.log('\n' + '═'.repeat(80));
  console.log('КОНЕЦ ОТЧЁТА');
  console.log('═'.repeat(80));
}

main().catch(console.error);
