/**
 * Extract clients from ticket text
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Расширенные паттерны клиентов
const CLIENT_PATTERNS = [
  [/валта/i, 'ВАЛТА'],
  [/кма|kma/i, 'КМА'],
  [/лаки[-\s]?сд|лаки/i, 'Лаки'],
  [/intercosmetology|интеркосметолог/i, 'Intercosmetology'],
  [/citilink|ситилинк/i, 'Citilink'],
  [/майдент|mydent|мойдент/i, 'МайДент24'],
  [/insales/i, 'InSales'],
  [/tom\s*tailor/i, 'Tom Tailor'],
  [/петрович/i, 'Петрович'],
  [/смарт\s*дс/i, 'Смарт ДС Рус'],
  [/улыбка\s*радуги/i, 'Улыбка Радуги'],
  [/псб\s*маркет/i, 'ПСБ Маркет'],
  [/пим[\.\s]*агрегац/i, 'PIM.Агрегация'],
  [/яндекс[\.\s]*маркет|пим[-\s]?ям/i, 'Яндекс.Маркет'],
  [/ozon|озон/i, 'Ozon'],
  [/wildberries|wb\s/i, 'Wildberries'],
  [/lamoda|ламода/i, 'Lamoda'],
  [/мегамаркет/i, 'МегаМаркет'],
  [/посылка\s*субагрегатор|красота/i, 'Посылка (Красота)'],
  [/семена\s*тут/i, 'Семена тут'],
  [/спвк/i, 'СПВК'],
  [/bitrix|битрикс/i, 'Bitrix (модуль)'],
];

function extractClient(text) {
  if (!text) return null;

  // Известные клиенты
  for (const [pattern, name] of CLIENT_PATTERNS) {
    if (pattern.test(text)) return name;
  }

  // ИП + ФИО
  const ip = text.match(/ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?/);
  if (ip) return ip[0];

  // ООО
  const ooo = text.match(/ООО\s*[«"]?([А-ЯЁа-яё0-9\s\-]+)/);
  if (ooo) return ooo[0].replace(/[«»"]/g, '').trim().substring(0, 25);

  return null;
}

// СД из текста
function extractDS(text) {
  if (!text) return null;
  if (/сдек|cdek/i.test(text)) return 'СДЕК';
  if (/dalli|далли/i.test(text)) return 'Dalli';
  if (/почта\s*росси/i.test(text)) return 'Почта России';
  if (/dpd|дпд/i.test(text)) return 'DPD';
  if (/5post|5пост/i.test(text)) return '5Post';
  if (/boxberry/i.test(text)) return 'Boxberry';
  return null;
}

// Проблемы из текста
function extractProblems(text) {
  const problems = [];
  if (/ошибк.*созда|не.*созда|order.*error|failed/i.test(text)) problems.push('Создание заказа');
  if (/интервал|interval.*некорр/i.test(text)) problems.push('Интервал доставки');
  if (/timeout|500|502|503|504/i.test(text)) problems.push('Timeout/5xx');
  if (/статус.*не.*обновл|sync/i.test(text)) problems.push('Статусы');
  if (/тариф.*недоступ|offer.*пуст/i.test(text)) problems.push('Тарифы');
  if (/пвз.*не\s*найден|точка.*не/i.test(text)) problems.push('ПВЗ не найден');
  if (/webhook|вебхук/i.test(text)) problems.push('Webhook');
  if (/этикетк|накладн|label/i.test(text)) problems.push('Этикетки');
  if (/возврат|return/i.test(text)) problems.push('Возврат');
  if (/модуль|plugin/i.test(text)) problems.push('Модуль');
  return [...new Set(problems)];
}

function getWeekRange(weeksAgo = 1) {
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

async function main() {
  const lastWeek = getWeekRange(1);

  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('*')
    .gte('created_at', lastWeek.start.toISOString())
    .lte('created_at', lastWeek.end.toISOString())
    .order('created_at', { ascending: false });

  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + '  КЛИЕНТЫ С ПРОБЛЕМАМИ (извлечено из текста тикетов)'.padEnd(78) + '║');
  console.log('║' + `  Неделя: 2-8 февраля | Всего тикетов: ${tickets.length}`.padEnd(78) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  const clientStats = {};

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');
    let client = extractClient(text);

    // Если клиент не найден в тексте — берём отправителя
    if (!client) {
      client = t.company_name || t.user_name || 'Unknown';
    }

    if (client === 'Unknown') continue;

    if (!clientStats[client]) {
      clientStats[client] = {
        total: 0,
        open: 0,
        tickets: [],
        problems: [],
        ds: []
      };
    }

    clientStats[client].total++;
    if (t.status !== 'closed') clientStats[client].open++;

    clientStats[client].tickets.push({
      id: t.ticket_id,
      status: t.status,
      subject: (t.subject || '').substring(0, 55),
      fromText: extractClient(text) !== null // клиент из текста или из отправителя
    });

    // Проблемы
    const probs = extractProblems(text);
    clientStats[client].problems.push(...probs);

    // СД
    const ds = extractDS(text);
    if (ds) clientStats[client].ds.push(ds);
  }

  // Сортируем по количеству
  const sorted = Object.entries(clientStats)
    .sort((a, b) => b[1].total - a[1].total);

  const identified = sorted.reduce((s, [_, d]) => s + d.total, 0);
  const fromText = sorted.reduce((s, [_, d]) => s + d.tickets.filter(t => t.fromText).length, 0);
  console.log(`\nКлиентов: ${sorted.length} | Тикетов: ${identified}`);
  console.log(`Из текста: ${fromText} | По отправителю: ${identified - fromText}\n`);

  for (const [client, data] of sorted) {
    const openMark = data.open > 0 ? ` ⚠️ ${data.open} открыто` : '';

    // Уникальные проблемы с количеством
    const problemCounts = {};
    data.problems.forEach(p => { problemCounts[p] = (problemCounts[p] || 0) + 1; });
    const topProblems = Object.entries(problemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([p, c]) => `${p} (${c})`)
      .join(', ') || '—';

    // Уникальные СД
    const dsCounts = {};
    data.ds.forEach(d => { dsCounts[d] = (dsCounts[d] || 0) + 1; });
    const dsInfo = Object.entries(dsCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([d, c]) => `${d} (${c})`)
      .join(', ') || '—';

    console.log('─'.repeat(80));
    console.log(`🏢 ${client} — ${data.total} тикетов${openMark}`);
    console.log(`   Проблемы: ${topProblems}`);
    console.log(`   СД: ${dsInfo}`);
    console.log('   Тикеты:');
    data.tickets.forEach(t => {
      const icon = t.status === 'closed' ? '✅' : '🔴';
      const src = t.fromText ? '' : ' [отправитель]';
      console.log(`      ${icon} #${t.id}${src}: ${t.subject}`);
    });
  }

  // Сводная таблица
  console.log('\n' + '═'.repeat(80));
  console.log('📊 СВОДНАЯ ТАБЛИЦА');
  console.log('═'.repeat(80));
  console.log('Клиент'.padEnd(25) + 'Тикетов'.padStart(8) + 'Открыто'.padStart(8) + '  Проблемы');
  console.log('─'.repeat(80));

  for (const [client, data] of sorted) {
    const problemCounts = {};
    data.problems.forEach(p => { problemCounts[p] = (problemCounts[p] || 0) + 1; });
    const topProblem = Object.entries(problemCounts).sort((a, b) => b[1] - a[1])[0];
    const probStr = topProblem ? `${topProblem[0]} (${topProblem[1]})` : '—';

    console.log(
      client.substring(0, 24).padEnd(25) +
      data.total.toString().padStart(8) +
      data.open.toString().padStart(8) +
      '  ' + probStr
    );
  }

  console.log('\n' + '═'.repeat(80));
}

main();
