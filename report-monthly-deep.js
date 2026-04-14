/**
 * DEEP MONTHLY ANALYTICS REPORT
 * Глубокая аналитика за месяц с топ-клиентами
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Системные ошибки (паттерны)
const SYSTEM_ERRORS = {
  'Ошибка создания заказа': {
    pattern: /ошибк.*созда|не\s*созда|order.*error|failed.*create|cannot.*create/i,
    area: 'Order API',
    severity: 'critical'
  },
  'Timeout/5xx': {
    pattern: /timeout|500|502|503|504|server.*error|внутренн.*ошибк/i,
    area: 'Infrastructure',
    severity: 'critical'
  },
  'Ошибка авторизации': {
    pattern: /401|403|auth.*error|unauthorized|доступ.*запрещ|неверн.*токен/i,
    area: 'Auth',
    severity: 'critical'
  },
  'Некорректный интервал доставки': {
    pattern: /интервал|interval|некорректно.*интервал|time.*delivery/i,
    area: 'API валидация',
    severity: 'high'
  },
  'ПВЗ не найден': {
    pattern: /пвз.*не\s*найден|точка.*не\s*найден|pickup.*not|deliveryPoint.*not/i,
    area: 'Справочник ПВЗ',
    severity: 'high'
  },
  'Тариф недоступен': {
    pattern: /тариф.*недоступ|тариф.*не\s*найден|tariff.*not|пустой.*список.*offer/i,
    area: 'Тарификация',
    severity: 'high'
  },
  'Статусы не обновляются': {
    pattern: /статус.*не.*обновл|не.*приход.*статус|sync.*status|статус.*застрял/i,
    area: 'Status Sync',
    severity: 'high'
  },
  'Webhook не работает': {
    pattern: /webhook|вебхук|callback.*не.*работ/i,
    area: 'Webhooks',
    severity: 'medium'
  },
  'Этикетка/Накладная': {
    pattern: /этикетк|накладн|label|print.*error|не.*печата/i,
    area: 'Documents',
    severity: 'medium'
  },
  'Ошибка валидации данных': {
    pattern: /валидац|validation|некорректн.*данн|invalid.*field/i,
    area: 'Data Validation',
    severity: 'medium'
  },
  'Проблема с трекингом': {
    pattern: /трек|track|отслежив|где.*заказ|где.*посылк/i,
    area: 'Tracking',
    severity: 'medium'
  },
  'Проблема с возвратом': {
    pattern: /возврат|return|обратн.*доставк/i,
    area: 'Returns',
    severity: 'medium'
  },
};

// Известные клиенты
const KNOWN_CLIENTS = [
  [/валта/i, 'ВАЛТА'],
  [/кма|kma/i, 'КМА'],
  [/лаки|lucky/i, 'Лаки'],
  [/intercosmetology/i, 'Intercosmetology'],
  [/citilink|ситилинк/i, 'Citilink'],
  [/майдент|mydent/i, 'МайДент24'],
  [/insales/i, 'InSales'],
  [/tom\s*tailor/i, 'Tom Tailor'],
  [/петрович/i, 'Петрович'],
  [/смарт\s*дс/i, 'Смарт ДС Рус'],
  [/псб.*маркет|psb.*market/i, 'ПСБ Маркет'],
  [/ив\s*роше|yves.*rocher/i, 'Ив Роше'],
  [/blok.*post|блок.*пост/i, 'Blok-Post'],
  [/яндекс/i, 'Яндекс'],
];

function extractClient(text, userName, userEmail) {
  if (!text && !userName && !userEmail) return null;

  const fullText = `${text || ''} ${userName || ''} ${userEmail || ''}`;

  for (const [pattern, name] of KNOWN_CLIENTS) {
    if (pattern.test(fullText)) return name;
  }

  // Извлечь ИП
  const ip = fullText.match(/ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?/);
  if (ip) return ip[0];

  // Извлечь ООО
  const ooo = fullText.match(/ООО\s*[«"]?([А-ЯЁа-яё0-9\s\-]+)/);
  if (ooo) return ooo[0].substring(0, 30);

  // Использовать имя пользователя если есть
  if (userName && userName.length > 2) return userName;

  return null;
}

function extractDS(text) {
  if (!text) return [];
  const ds = [];
  if (/сдек|cdek/i.test(text)) ds.push('СДЕК');
  if (/dalli|далли/i.test(text)) ds.push('Dalli');
  if (/почта\s*росси|ems|почт.*росс/i.test(text)) ds.push('Почта России');
  if (/dpd|дпд/i.test(text)) ds.push('DPD');
  if (/5post|5пост|5\s*пост/i.test(text)) ds.push('5Post');
  if (/boxberry|боксберри/i.test(text)) ds.push('Boxberry');
  if (/яндекс.*доставк|yandex.*delivery/i.test(text)) ds.push('Яндекс Доставка');
  if (/dostavista|достависта/i.test(text)) ds.push('Dostavista');
  if (/pony.*express|пони.*экспресс/i.test(text)) ds.push('Pony Express');
  return ds;
}

function getMonthRange() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 30);
  start.setHours(0, 0, 0, 0);
  return { start, end: now };
}

function getWeekNumber(date, monthStart) {
  const diff = date - monthStart;
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function formatDuration(minutes) {
  if (!minutes || minutes < 0) return '-';
  if (minutes < 60) return `${minutes}м`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return `${hours}ч ${mins}м`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}д ${remainingHours}ч`;
}

async function main() {
  const { start, end } = getMonthRange();

  const { data: tickets, error } = await supabase
    .from('support_tickets')
    .select('*')
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching tickets:', error);
    return;
  }

  const formatD = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  // ═══════════════════════════════════════════════════════════════
  // ЗАГОЛОВОК
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '╔' + '═'.repeat(88) + '╗');
  console.log('║' + ' ГЛУБОКАЯ АНАЛИТИКА ПОДДЕРЖКИ ЗА МЕСЯЦ'.padStart(55).padEnd(88) + '║');
  console.log('║' + ` ${formatD(start)} — ${formatD(end)}`.padStart(55).padEnd(88) + '║');
  console.log('╚' + '═'.repeat(88) + '╝');

  // ═══════════════════════════════════════════════════════════════
  // ОБЩАЯ СТАТИСТИКА
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('📊 ОБЩАЯ СТАТИСТИКА');
  console.log('═'.repeat(90));

  const total = tickets.length;
  const closed = tickets.filter(t => t.status === 'closed').length;
  const open = tickets.filter(t => t.status !== 'closed').length;

  // Среднее время закрытия
  const closedTickets = tickets.filter(t => t.closing_speed && t.closing_speed > 0);
  const avgClosingSpeed = closedTickets.length > 0
    ? Math.round(closedTickets.reduce((sum, t) => sum + t.closing_speed, 0) / closedTickets.length)
    : 0;

  console.log(`\n  Всего тикетов:        ${total}`);
  console.log(`  Закрыто:              ${closed} (${(closed/total*100).toFixed(1)}%)`);
  console.log(`  Открыто:              ${open} (${(open/total*100).toFixed(1)}%)`);
  console.log(`  Среднее время закрытия: ${formatDuration(avgClosingSpeed)}`);
  console.log(`  В среднем за день:    ${(total/30).toFixed(1)} тикетов`);

  // ═══════════════════════════════════════════════════════════════
  // ДИНАМИКА ПО НЕДЕЛЯМ
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('📈 ДИНАМИКА ПО НЕДЕЛЯМ');
  console.log('═'.repeat(90));

  const weeklyStats = {};
  for (const t of tickets) {
    const week = getWeekNumber(new Date(t.created_at), start);
    if (!weeklyStats[week]) weeklyStats[week] = { total: 0, closed: 0, avgSpeed: [] };
    weeklyStats[week].total++;
    if (t.status === 'closed') weeklyStats[week].closed++;
    if (t.closing_speed > 0) weeklyStats[week].avgSpeed.push(t.closing_speed);
  }

  console.log('\n  Неделя  │ Тикетов │ Закрыто │ Ср.время закрытия │ Тренд');
  console.log('  ' + '─'.repeat(70));

  let prevWeekTotal = 0;
  for (const week of Object.keys(weeklyStats).sort((a, b) => a - b)) {
    const data = weeklyStats[week];
    const avgSpeed = data.avgSpeed.length > 0
      ? Math.round(data.avgSpeed.reduce((a, b) => a + b, 0) / data.avgSpeed.length)
      : 0;
    const trend = prevWeekTotal > 0
      ? (data.total > prevWeekTotal ? '↑' : data.total < prevWeekTotal ? '↓' : '→')
      : ' ';
    const trendColor = trend === '↑' ? '🔴' : trend === '↓' ? '🟢' : '⚪';

    console.log(`  Неделя ${week} │   ${String(data.total).padStart(3)}   │   ${String(data.closed).padStart(3)}   │    ${formatDuration(avgSpeed).padEnd(12)}  │ ${trendColor} ${trend}`);
    prevWeekTotal = data.total;
  }

  // ═══════════════════════════════════════════════════════════════
  // ТОП КЛИЕНТОВ (КЛЮЧЕВОЙ РАЗДЕЛ)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('👥 ТОП КЛИЕНТОВ ПО КОЛИЧЕСТВУ ОБРАЩЕНИЙ');
  console.log('═'.repeat(90));

  const clientStats = {};

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');
    const client = extractClient(text, t.user_name, t.user_email) || 'Unknown';

    if (!clientStats[client]) {
      clientStats[client] = {
        total: 0,
        closed: 0,
        errors: {},
        ds: {},
        tickets: [],
        avgSpeed: [],
        channels: {},
        weeklyTrend: {}
      };
    }

    clientStats[client].total++;
    clientStats[client].tickets.push(t);

    if (t.status === 'closed') clientStats[client].closed++;
    if (t.closing_speed > 0) clientStats[client].avgSpeed.push(t.closing_speed);

    // Канал
    const channel = t.channel || 'unknown';
    clientStats[client].channels[channel] = (clientStats[client].channels[channel] || 0) + 1;

    // Недельный тренд
    const week = getWeekNumber(new Date(t.created_at), start);
    clientStats[client].weeklyTrend[week] = (clientStats[client].weeklyTrend[week] || 0) + 1;

    // Ошибки
    for (const [errorName, cfg] of Object.entries(SYSTEM_ERRORS)) {
      if (cfg.pattern.test(text)) {
        clientStats[client].errors[errorName] = (clientStats[client].errors[errorName] || 0) + 1;
      }
    }

    // СД
    for (const ds of extractDS(text)) {
      clientStats[client].ds[ds] = (clientStats[client].ds[ds] || 0) + 1;
    }
  }

  const sortedClients = Object.entries(clientStats)
    .filter(([name]) => name !== 'Unknown')
    .sort((a, b) => b[1].total - a[1].total);

  const topClients = sortedClients.slice(0, 15);

  console.log('\n  #  │ Клиент                         │ Тикетов │ Закрыто │ Ср.время │ Тренд');
  console.log('  ' + '─'.repeat(85));

  topClients.forEach(([client, data], idx) => {
    const avgSpeed = data.avgSpeed.length > 0
      ? Math.round(data.avgSpeed.reduce((a, b) => a + b, 0) / data.avgSpeed.length)
      : 0;

    // Тренд: сравниваем первые 2 недели с последними 2
    const weeks = Object.keys(data.weeklyTrend).map(Number).sort((a, b) => a - b);
    let trend = '→';
    if (weeks.length >= 2) {
      const firstHalf = weeks.slice(0, Math.ceil(weeks.length/2)).reduce((s, w) => s + (data.weeklyTrend[w] || 0), 0);
      const secondHalf = weeks.slice(Math.ceil(weeks.length/2)).reduce((s, w) => s + (data.weeklyTrend[w] || 0), 0);
      if (secondHalf > firstHalf * 1.2) trend = '↑↑';
      else if (secondHalf > firstHalf) trend = '↑';
      else if (secondHalf < firstHalf * 0.8) trend = '↓↓';
      else if (secondHalf < firstHalf) trend = '↓';
    }
    const trendIcon = trend.includes('↑') ? '🔴' : trend.includes('↓') ? '🟢' : '⚪';

    console.log(`  ${String(idx + 1).padStart(2)} │ ${client.substring(0, 30).padEnd(30)} │   ${String(data.total).padStart(3)}   │   ${String(data.closed).padStart(3)}   │ ${formatDuration(avgSpeed).padEnd(8)} │ ${trendIcon} ${trend}`);
  });

  // Детальная информация по топ-5 клиентам
  console.log('\n' + '─'.repeat(90));
  console.log('  ДЕТАЛИЗАЦИЯ ПО ТОП-5 КЛИЕНТАМ:');
  console.log('─'.repeat(90));

  for (const [client, data] of topClients.slice(0, 5)) {
    console.log(`\n  🏢 ${client}`);
    console.log(`     Тикетов: ${data.total} | Закрыто: ${data.closed} (${(data.closed/data.total*100).toFixed(0)}%)`);

    const topError = Object.entries(data.errors).sort((a, b) => b[1] - a[1])[0];
    if (topError) console.log(`     Главная проблема: ${topError[0]} (${topError[1]} тикетов)`);

    const topDS = Object.entries(data.ds).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topDS.length > 0) console.log(`     СД: ${topDS.map(([d, n]) => `${d}(${n})`).join(', ')}`);

    const topChannel = Object.entries(data.channels).sort((a, b) => b[1] - a[1])[0];
    if (topChannel) console.log(`     Основной канал: ${topChannel[0]} (${topChannel[1]})`);

    const openTickets = data.tickets.filter(t => t.status !== 'closed');
    if (openTickets.length > 0) {
      console.log(`     ⚠️  Открытых: ${openTickets.length}`);
      openTickets.slice(0, 2).forEach(t => {
        console.log(`        #${t.ticket_id}: ${(t.subject || '').substring(0, 50)}`);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // СИСТЕМНЫЕ ОШИБКИ
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('🔴 СИСТЕМНЫЕ ОШИБКИ И ПРОБЛЕМЫ ПРОДУКТА');
  console.log('═'.repeat(90));

  const errorStats = {};

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');

    for (const [errorName, cfg] of Object.entries(SYSTEM_ERRORS)) {
      if (cfg.pattern.test(text)) {
        if (!errorStats[errorName]) {
          errorStats[errorName] = { count: 0, config: cfg, tickets: [], clients: {}, ds: {} };
        }
        errorStats[errorName].count++;
        errorStats[errorName].tickets.push(t);

        const client = extractClient(text, t.user_name, t.user_email) || 'Unknown';
        errorStats[errorName].clients[client] = (errorStats[errorName].clients[client] || 0) + 1;

        for (const ds of extractDS(text)) {
          errorStats[errorName].ds[ds] = (errorStats[errorName].ds[ds] || 0) + 1;
        }
      }
    }
  }

  const sortedErrors = Object.entries(errorStats).sort((a, b) => b[1].count - a[1].count);

  console.log('\n  Ошибка                              │ Кол-во │ Severity │ Область');
  console.log('  ' + '─'.repeat(80));

  for (const [errorName, data] of sortedErrors) {
    const severityIcon = data.config.severity === 'critical' ? '🔴' :
                         data.config.severity === 'high' ? '🟠' : '🟡';
    console.log(`  ${severityIcon} ${errorName.padEnd(35)} │  ${String(data.count).padStart(3)}   │ ${data.config.severity.padEnd(8)} │ ${data.config.area}`);
  }

  // Детализация критических ошибок
  console.log('\n' + '─'.repeat(90));
  console.log('  ДЕТАЛИЗАЦИЯ КРИТИЧЕСКИХ ОШИБОК:');
  console.log('─'.repeat(90));

  for (const [errorName, data] of sortedErrors.filter(([, d]) => d.config.severity === 'critical')) {
    console.log(`\n  🔴 ${errorName} (${data.count} тикетов)`);

    const topClients = Object.entries(data.clients).sort((a, b) => b[1] - a[1]).slice(0, 3);
    console.log(`     Клиенты: ${topClients.map(([c, n]) => `${c}(${n})`).join(', ')}`);

    const topDS = Object.entries(data.ds).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topDS.length > 0) console.log(`     СД: ${topDS.map(([d, n]) => `${d}(${n})`).join(', ')}`);

    console.log('     Примеры:');
    data.tickets.slice(0, 3).forEach(t => {
      console.log(`     • #${t.ticket_id}: ${(t.subject || '').substring(0, 55)}`);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // СЛУЖБЫ ДОСТАВКИ
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('🚚 СТАТИСТИКА ПО СЛУЖБАМ ДОСТАВКИ');
  console.log('═'.repeat(90));

  const dsStats = {};

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');
    const dsList = extractDS(text);

    for (const ds of dsList) {
      if (!dsStats[ds]) dsStats[ds] = { total: 0, errors: {}, clients: {} };
      dsStats[ds].total++;

      const client = extractClient(text, t.user_name, t.user_email);
      if (client) dsStats[ds].clients[client] = (dsStats[ds].clients[client] || 0) + 1;

      for (const [errorName, cfg] of Object.entries(SYSTEM_ERRORS)) {
        if (cfg.pattern.test(text)) {
          dsStats[ds].errors[errorName] = (dsStats[ds].errors[errorName] || 0) + 1;
        }
      }
    }
  }

  const sortedDS = Object.entries(dsStats).sort((a, b) => b[1].total - a[1].total);

  console.log('\n  СД                │ Тикетов │ Топ ошибка                    │ Топ клиент');
  console.log('  ' + '─'.repeat(85));

  for (const [ds, data] of sortedDS) {
    const topError = Object.entries(data.errors).sort((a, b) => b[1] - a[1])[0];
    const topClient = Object.entries(data.clients).sort((a, b) => b[1] - a[1])[0];

    console.log(`  ${ds.padEnd(17)} │   ${String(data.total).padStart(3)}   │ ${(topError ? topError[0] : '-').substring(0, 29).padEnd(29)} │ ${topClient ? topClient[0].substring(0, 15) : '-'}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // КАНАЛЫ ОБРАЩЕНИЙ
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('📬 КАНАЛЫ ОБРАЩЕНИЙ');
  console.log('═'.repeat(90));

  const channelStats = {};
  for (const t of tickets) {
    const ch = t.channel || 'unknown';
    if (!channelStats[ch]) channelStats[ch] = { total: 0, closed: 0, avgSpeed: [] };
    channelStats[ch].total++;
    if (t.status === 'closed') channelStats[ch].closed++;
    if (t.closing_speed > 0) channelStats[ch].avgSpeed.push(t.closing_speed);
  }

  console.log('\n  Канал           │ Тикетов │  %   │ Закрыто │ Ср.время');
  console.log('  ' + '─'.repeat(60));

  for (const [channel, data] of Object.entries(channelStats).sort((a, b) => b[1].total - a[1].total)) {
    const pct = (data.total / total * 100).toFixed(1);
    const avgSpeed = data.avgSpeed.length > 0
      ? Math.round(data.avgSpeed.reduce((a, b) => a + b, 0) / data.avgSpeed.length)
      : 0;
    console.log(`  ${channel.padEnd(17)} │   ${String(data.total).padStart(3)}   │ ${pct.padStart(4)}% │   ${String(data.closed).padStart(3)}   │ ${formatDuration(avgSpeed)}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // РИСКИ И РЕКОМЕНДАЦИИ
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('⚠️  РИСКИ И РЕКОМЕНДАЦИИ');
  console.log('═'.repeat(90));

  const risks = [];

  // Критические ошибки
  for (const [errorName, data] of sortedErrors) {
    if (data.config.severity === 'critical' && data.count >= 5) {
      risks.push({
        level: 'CRITICAL',
        text: `${errorName}: ${data.count} тикетов за месяц`,
        area: data.config.area,
        action: `Немедленно исследовать root cause в ${data.config.area}`
      });
    } else if (data.config.severity === 'high' && data.count >= 10) {
      risks.push({
        level: 'HIGH',
        text: `${errorName}: ${data.count} тикетов за месяц`,
        area: data.config.area,
        action: `Приоритетно исправить проблему в ${data.config.area}`
      });
    }
  }

  // Клиенты с растущим трендом обращений
  for (const [client, data] of topClients.slice(0, 10)) {
    const weeks = Object.keys(data.weeklyTrend).map(Number).sort((a, b) => a - b);
    if (weeks.length >= 2) {
      const firstHalf = weeks.slice(0, Math.ceil(weeks.length/2)).reduce((s, w) => s + (data.weeklyTrend[w] || 0), 0);
      const secondHalf = weeks.slice(Math.ceil(weeks.length/2)).reduce((s, w) => s + (data.weeklyTrend[w] || 0), 0);
      if (secondHalf > firstHalf * 1.5 && data.total >= 5) {
        risks.push({
          level: 'HIGH',
          text: `Клиент "${client}": рост обращений (+${((secondHalf/firstHalf - 1) * 100).toFixed(0)}%)`,
          area: 'Customer Success',
          action: 'Провести созвон, выявить причину роста обращений'
        });
      }
    }
  }

  // Открытые тикеты от крупных клиентов
  for (const [client, data] of topClients.slice(0, 5)) {
    const openCount = data.tickets.filter(t => t.status !== 'closed').length;
    if (openCount >= 3) {
      risks.push({
        level: 'MEDIUM',
        text: `"${client}": ${openCount} открытых тикетов`,
        area: 'Support Operations',
        action: 'Приоритизировать закрытие тикетов клиента'
      });
    }
  }

  risks.sort((a, b) => {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
    return order[a.level] - order[b.level];
  });

  if (risks.length === 0) {
    console.log('\n  ✅ Критических рисков не выявлено');
  } else {
    risks.forEach((r, i) => {
      const icon = r.level === 'CRITICAL' ? '🔴' : r.level === 'HIGH' ? '🟠' : '🟡';
      console.log(`\n  ${i + 1}. ${icon} [${r.level}] ${r.text}`);
      console.log(`     Область: ${r.area}`);
      console.log(`     Действие: ${r.action}`);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // РЕКОМЕНДАЦИИ ПО УЛУЧШЕНИЮ
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('💡 РЕКОМЕНДАЦИИ ПО УЛУЧШЕНИЮ ПРОДУКТА');
  console.log('═'.repeat(90));

  const recommendations = [];

  if (errorStats['Ошибка создания заказа']?.count >= 10) {
    recommendations.push({
      priority: 1,
      area: 'Order API',
      problem: `${errorStats['Ошибка создания заказа'].count} ошибок создания заказов`,
      solution: 'Добавить детальную валидацию на фронте, улучшить сообщения об ошибках API'
    });
  }

  if (errorStats['Тариф недоступен']?.count >= 5) {
    recommendations.push({
      priority: 2,
      area: 'Pricing',
      problem: 'Тарифы недоступны',
      solution: 'Показывать причину недоступности (вес/габариты/направление) и предлагать альтернативы'
    });
  }

  if (errorStats['ПВЗ не найден']?.count >= 5) {
    recommendations.push({
      priority: 2,
      area: 'Data',
      problem: 'ПВЗ не найден',
      solution: 'Настроить автоматическое обновление справочника ПВЗ, добавить fuzzy search'
    });
  }

  if (errorStats['Статусы не обновляются']?.count >= 5) {
    recommendations.push({
      priority: 2,
      area: 'Integrations',
      problem: 'Статусы не синхронизируются',
      solution: 'Добавить мониторинг синхронизации статусов, алерты при задержках'
    });
  }

  if (avgClosingSpeed > 60 * 24) { // > 1 день
    recommendations.push({
      priority: 3,
      area: 'Support Ops',
      problem: `Среднее время закрытия ${formatDuration(avgClosingSpeed)}`,
      solution: 'Внедрить автоматизацию для типовых вопросов, FAQ bot'
    });
  }

  recommendations.sort((a, b) => a.priority - b.priority);

  recommendations.forEach((r, i) => {
    console.log(`\n  ${i + 1}. [${r.area}] ${r.problem}`);
    console.log(`     → ${r.solution}`);
  });

  // ═══════════════════════════════════════════════════════════════
  // ИТОГИ
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('📋 КЛЮЧЕВЫЕ ВЫВОДЫ');
  console.log('═'.repeat(90));

  console.log(`
  • Всего обработано ${total} тикетов за месяц
  • Процент закрытия: ${(closed/total*100).toFixed(1)}%
  • Среднее время решения: ${formatDuration(avgClosingSpeed)}
  • Топ-3 клиента по обращениям: ${topClients.slice(0, 3).map(([c, d]) => `${c}(${d.total})`).join(', ')}
  • Главные проблемы: ${sortedErrors.slice(0, 3).map(([e, d]) => `${e}(${d.count})`).join(', ')}
  • Выявлено рисков: ${risks.length}
  `);

  console.log('═'.repeat(90));
  console.log('КОНЕЦ ОТЧЁТА');
  console.log('═'.repeat(90) + '\n');
}

main().catch(console.error);
