/**
 * ANALYTICS BY MENTIONED CLIENT
 * Анализ по клиентам, упомянутым в тикетах
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Паттерны для извлечения клиентов из текста
function extractClients(text) {
  if (!text) return [];

  const clients = [];

  // ИП + ФИО
  const ipMatches = text.match(/ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?(?:\s+[А-ЯЁ][а-яё]+)?/g);
  if (ipMatches) clients.push(...ipMatches.map(m => m.trim()));

  // ООО + название
  const oooMatches = text.match(/ООО\s*[«"]?[А-ЯЁA-Za-zа-яё0-9\s\-\.]+[»"]?/g);
  if (oooMatches) clients.push(...oooMatches.map(m => m.replace(/[«»""]/g, '').trim().substring(0, 40)));

  // Известные клиенты/бренды
  const knownClients = [
    { pattern: /яндекс[\s\.\-]?маркет/i, name: 'Яндекс.Маркет' },
    { pattern: /яндекс[\s\.\-]?доставка/i, name: 'Яндекс.Доставка' },
    { pattern: /ozon|озон/i, name: 'Ozon' },
    { pattern: /wildberries|вайлдберриз|wb/i, name: 'Wildberries' },
    { pattern: /citilink|ситилинк/i, name: 'Citilink' },
    { pattern: /lamoda|ламода/i, name: 'Lamoda' },
    { pattern: /улыбка\s*радуги/i, name: 'Улыбка Радуги' },
    { pattern: /лаки|lucky/i, name: 'Лаки' },
    { pattern: /intercosmetology|интеркосметолог/i, name: 'Intercosmetology' },
    { pattern: /майдент|mydent|мойдент/i, name: 'МайДент24' },
    { pattern: /cdek|сдек/i, name: 'СДЕК (СД)' },
    { pattern: /почта\s*росси/i, name: 'Почта России (СД)' },
    { pattern: /dalli|далли/i, name: 'Dalli (СД)' },
    { pattern: /dpd|дпд/i, name: 'DPD (СД)' },
    { pattern: /boxberry|боксберри/i, name: 'Boxberry (СД)' },
    { pattern: /5post|5пост|пятёрочка/i, name: '5Post' },
    { pattern: /кма|kma/i, name: 'КМА' },
    { pattern: /алискеров/i, name: 'ИП Алискерова' },
    { pattern: /амирасланов/i, name: 'ИП Амирасланов' },
    { pattern: /bitrix|битрикс/i, name: 'Bitrix (модуль)' },
    { pattern: /insales/i, name: 'InSales' },
    { pattern: /1с|1c[\-\s]?битрикс/i, name: '1С-Битрикс' },
    { pattern: /мегамаркет/i, name: 'МегаМаркет' },
    { pattern: /сбермаркет|сбер\s*маркет/i, name: 'СберМаркет' },
  ];

  for (const { pattern, name } of knownClients) {
    if (pattern.test(text)) {
      clients.push(name);
    }
  }

  return [...new Set(clients)]; // уникальные
}

async function main() {
  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false });

  console.log('='.repeat(60));
  console.log('АНАЛИТИКА ПО КЛИЕНТАМ (упомянутым в тикетах)');
  console.log('Период: последние 30 дней | Всего тикетов:', tickets.length);
  console.log('='.repeat(60));

  // Извлекаем клиентов из каждого тикета
  const clientStats = {};
  const ticketsWithClients = [];

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');
    const clients = extractClients(text);

    if (clients.length > 0) {
      ticketsWithClients.push({ ...t, mentioned_clients: clients });

      for (const client of clients) {
        if (!clientStats[client]) {
          clientStats[client] = {
            total: 0,
            closed: 0,
            open: 0,
            tickets: [],
            issues: {}
          };
        }
        clientStats[client].total++;
        clientStats[client].tickets.push(t.ticket_id);
        if (t.status === 'closed') clientStats[client].closed++;
        else clientStats[client].open++;
      }
    }
  }

  // Категоризация проблем для каждого клиента
  const issuePatterns = {
    'Создание заказа': /создан|не\s*созда|ошибк.*заказ|order.*error|failed/i,
    'ПВЗ не найден': /пвз.*не\s*найден|точка.*не\s*найден|pickup.*not\s*found/i,
    'API ошибка': /api.*ошибк|error.*api|400|401|403|500|timeout/i,
    'Статус не обновляется': /статус.*не.*обновл|sync|не\s*приход.*статус/i,
    'Тариф/Расчёт': /тариф|расчёт|стоимость.*доставк|calculation/i,
    'Интервал доставки': /интервал|время.*доставк|time.*delivery/i,
    'Трекинг': /трек|track|отслежив/i,
    'Модуль/Плагин': /модуль|plugin|плагин|битрикс/i,
    'Возврат': /возврат|return|отмен/i,
    'Этикетка/Накладная': /этикетк|накладн|label|print/i,
  };

  for (const t of ticketsWithClients) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');

    for (const client of t.mentioned_clients) {
      for (const [issue, pattern] of Object.entries(issuePatterns)) {
        if (pattern.test(text)) {
          clientStats[client].issues[issue] = (clientStats[client].issues[issue] || 0) + 1;
        }
      }
    }
  }

  // Сортируем по количеству тикетов
  const sortedClients = Object.entries(clientStats)
    .sort((a, b) => b[1].total - a[1].total);

  // Выводим статистику
  console.log('\n📊 ТОП КЛИЕНТОВ ПО КОЛИЧЕСТВУ ТИКЕТОВ');
  console.log('-'.repeat(60));

  sortedClients.slice(0, 20).forEach(([client, stats], i) => {
    const bar = '█'.repeat(Math.min(stats.total, 30));
    const openMark = stats.open > 0 ? ` ⚠️ ${stats.open} открыто` : '';
    console.log(`${(i+1).toString().padStart(2)}. ${client.padEnd(25)} ${stats.total.toString().padStart(3)} ${bar}${openMark}`);
  });

  // Детальный анализ по топ клиентам
  console.log('\n' + '='.repeat(60));
  console.log('ДЕТАЛЬНЫЙ АНАЛИЗ ПО КЛИЕНТАМ');
  console.log('='.repeat(60));

  sortedClients.slice(0, 15).forEach(([client, stats]) => {
    console.log(`\n🏢 ${client}`);
    console.log('-'.repeat(40));
    console.log(`   Тикетов: ${stats.total} (закрыто: ${stats.closed}, открыто: ${stats.open})`);

    if (Object.keys(stats.issues).length > 0) {
      console.log('   Проблемы:');
      Object.entries(stats.issues)
        .sort((a, b) => b[1] - a[1])
        .forEach(([issue, count]) => {
          console.log(`     - ${issue}: ${count}`);
        });
    }
  });

  // Анализ по типам проблем (глобально по всем клиентам)
  console.log('\n' + '='.repeat(60));
  console.log('ПРОБЛЕМЫ ПО ТИПАМ (все клиенты)');
  console.log('='.repeat(60));

  const globalIssues = {};
  for (const [client, stats] of sortedClients) {
    for (const [issue, count] of Object.entries(stats.issues)) {
      if (!globalIssues[issue]) globalIssues[issue] = { total: 0, clients: [] };
      globalIssues[issue].total += count;
      globalIssues[issue].clients.push({ client, count });
    }
  }

  Object.entries(globalIssues)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([issue, data]) => {
      console.log(`\n🔧 ${issue}: ${data.total} тикетов`);
      data.clients
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .forEach(({ client, count }) => {
          console.log(`   - ${client}: ${count}`);
        });
    });

  // Клиенты с открытыми тикетами
  const clientsWithOpen = sortedClients.filter(([_, s]) => s.open > 0);
  if (clientsWithOpen.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('⚠️  КЛИЕНТЫ С ОТКРЫТЫМИ ТИКЕТАМИ');
    console.log('='.repeat(60));

    clientsWithOpen.forEach(([client, stats]) => {
      console.log(`\n${client}: ${stats.open} открытых`);
      // Найти открытые тикеты этого клиента
      const openTickets = ticketsWithClients
        .filter(t => t.status !== 'closed' && t.mentioned_clients.includes(client));
      openTickets.forEach(t => {
        const subject = (t.subject || '').substring(0, 50);
        console.log(`   #${t.ticket_id}: ${subject}`);
      });
    });
  }

  console.log('\n' + '='.repeat(60));
}

main().catch(console.error);
