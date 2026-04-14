/**
 * PRODUCT INSIGHTS REPORT - LAST WEEK
 * Системные ошибки, клиенты, риски, рекомендации
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Системные ошибки (паттерны из текста тикетов)
const SYSTEM_ERRORS = {
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
  'Ошибка создания заказа': {
    pattern: /ошибк.*созда|не\s*созда|order.*error|failed.*create/i,
    area: 'Order API',
    severity: 'critical'
  },
  'Тариф недоступен': {
    pattern: /тариф.*недоступ|тариф.*не\s*найден|tariff.*not|пустой.*список.*offer/i,
    area: 'Тарификация',
    severity: 'high'
  },
  'Webhook не работает': {
    pattern: /webhook|вебхук|не.*приход.*статус|callback/i,
    area: 'Webhooks',
    severity: 'medium'
  },
  'Статусы не обновляются': {
    pattern: /статус.*не.*обновл|не.*приход.*статус|sync.*status/i,
    area: 'Status Sync',
    severity: 'high'
  },
  'Ошибка валидации данных': {
    pattern: /валидац|validation|некорректн.*данн|invalid/i,
    area: 'Data Validation',
    severity: 'medium'
  },
  'Этикетка/Накладная': {
    pattern: /этикетк|накладн|label|print.*error/i,
    area: 'Documents',
    severity: 'medium'
  },
  'Ошибка авторизации': {
    pattern: /401|403|auth.*error|unauthorized|доступ.*запрещ/i,
    area: 'Auth',
    severity: 'critical'
  },
  'Timeout/5xx': {
    pattern: /timeout|500|502|503|504|server.*error/i,
    area: 'Infrastructure',
    severity: 'critical'
  },
};

// Клиенты
function extractClient(text) {
  if (!text) return null;

  const known = [
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
  ];

  for (const [pattern, name] of known) {
    if (pattern.test(text)) return name;
  }

  const ip = text.match(/ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?/);
  if (ip) return ip[0];

  const ooo = text.match(/ООО\s*[«"]?([А-ЯЁа-яё0-9\s\-]+)/);
  if (ooo) return ooo[0].substring(0, 25);

  return null;
}

// СД
function extractDS(text) {
  if (!text) return [];
  const ds = [];
  if (/сдек|cdek/i.test(text)) ds.push('СДЕК');
  if (/dalli|далли/i.test(text)) ds.push('Dalli');
  if (/почта\s*росси|ems/i.test(text)) ds.push('Почта России');
  if (/dpd|дпд/i.test(text)) ds.push('DPD');
  if (/5post|5пост/i.test(text)) ds.push('5Post');
  if (/boxberry|боксберри/i.test(text)) ds.push('Boxberry');
  if (/яндекс.*доставк/i.test(text)) ds.push('Яндекс');
  return ds;
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
  const prevWeek = getWeekRange(2);

  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('*')
    .gte('created_at', lastWeek.start.toISOString())
    .lte('created_at', lastWeek.end.toISOString())
    .order('created_at', { ascending: false });

  const { data: prevTickets } = await supabase
    .from('support_tickets')
    .select('*')
    .gte('created_at', prevWeek.start.toISOString())
    .lte('created_at', prevWeek.end.toISOString());

  const formatD = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' ОТЧЁТ ПО ПРОДУКТУ: ПРОШЛАЯ НЕДЕЛЯ'.padStart(50).padEnd(78) + '║');
  console.log('║' + ` ${formatD(lastWeek.start)} — ${formatD(lastWeek.end)}`.padStart(50).padEnd(78) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  console.log(`\nВсего тикетов: ${tickets.length} (пред. неделя: ${prevTickets.length})`);
  const closed = tickets.filter(t => t.status === 'closed').length;
  console.log(`Закрыто: ${closed} (${(closed/tickets.length*100).toFixed(0)}%)`);

  // ═══════════════════════════════════════════════════════════════
  // СИСТЕМНЫЕ ОШИБКИ
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(80));
  console.log('🔴 СИСТЕМНЫЕ ОШИБКИ И ПРОБЛЕМЫ ПРОДУКТА');
  console.log('═'.repeat(80));

  const errorStats = {};
  const errorTickets = {};

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');

    for (const [errorName, config] of Object.entries(SYSTEM_ERRORS)) {
      if (config.pattern.test(text)) {
        if (!errorStats[errorName]) {
          errorStats[errorName] = { count: 0, config, tickets: [] };
        }
        errorStats[errorName].count++;
        errorStats[errorName].tickets.push({
          id: t.ticket_id,
          client: extractClient(text) || t.user_name,
          ds: extractDS(text),
          subject: (t.subject || '').substring(0, 60)
        });
      }
    }
  }

  const sortedErrors = Object.entries(errorStats).sort((a, b) => b[1].count - a[1].count);

  for (const [errorName, data] of sortedErrors) {
    const severityIcon = data.config.severity === 'critical' ? '🔴' :
                         data.config.severity === 'high' ? '🟠' : '🟡';

    console.log(`\n${severityIcon} ${errorName}`);
    console.log(`   Область: ${data.config.area} | Тикетов: ${data.count} | Severity: ${data.config.severity}`);
    console.log('   Примеры:');
    data.tickets.slice(0, 3).forEach(t => {
      const dsInfo = t.ds.length > 0 ? ` [${t.ds.join(', ')}]` : '';
      console.log(`   • #${t.id} ${(t.client || 'Unknown').substring(0, 15)}${dsInfo}: ${t.subject.substring(0, 45)}`);
    });
    if (data.tickets.length > 3) {
      console.log(`   ... и ещё ${data.tickets.length - 3} тикетов`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // КЛИЕНТЫ
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(80));
  console.log('👥 КЛИЕНТЫ С НАИБОЛЬШИМ КОЛИЧЕСТВОМ ПРОБЛЕМ');
  console.log('═'.repeat(80));

  const clientStats = {};

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');
    const client = extractClient(text) || t.user_name || 'Unknown';

    if (!clientStats[client]) {
      clientStats[client] = { total: 0, errors: {}, ds: {}, tickets: [] };
    }
    clientStats[client].total++;
    clientStats[client].tickets.push(t);

    // Ошибки клиента
    for (const [errorName, config] of Object.entries(SYSTEM_ERRORS)) {
      if (config.pattern.test(text)) {
        clientStats[client].errors[errorName] = (clientStats[client].errors[errorName] || 0) + 1;
      }
    }

    // СД клиента
    for (const ds of extractDS(text)) {
      clientStats[client].ds[ds] = (clientStats[client].ds[ds] || 0) + 1;
    }
  }

  const sortedClients = Object.entries(clientStats)
    .filter(([name]) => name !== 'Unknown')
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);

  for (const [client, data] of sortedClients) {
    const topError = Object.entries(data.errors).sort((a, b) => b[1] - a[1])[0];
    const topDS = Object.entries(data.ds).sort((a, b) => b[1] - a[1])[0];

    console.log(`\n🏢 ${client} — ${data.total} тикетов`);
    if (topError) console.log(`   Главная проблема: ${topError[0]} (${topError[1]})`);
    if (topDS) console.log(`   СД: ${topDS[0]} (${topDS[1]})`);

    const openTickets = data.tickets.filter(t => t.status !== 'closed');
    if (openTickets.length > 0) {
      console.log(`   ⚠️ Открытых: ${openTickets.length}`);
      openTickets.forEach(t => {
        console.log(`      #${t.ticket_id}: ${(t.subject || '').substring(0, 50)}`);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ПРОБЛЕМЫ ПО СД
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(80));
  console.log('🚚 ПРОБЛЕМЫ ПО СЛУЖБАМ ДОСТАВКИ');
  console.log('═'.repeat(80));

  const dsStats = {};

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');
    const dsList = extractDS(text);

    for (const ds of dsList) {
      if (!dsStats[ds]) dsStats[ds] = { total: 0, errors: {}, clients: {} };
      dsStats[ds].total++;

      const client = extractClient(text) || t.user_name;
      if (client) dsStats[ds].clients[client] = (dsStats[ds].clients[client] || 0) + 1;

      for (const [errorName, config] of Object.entries(SYSTEM_ERRORS)) {
        if (config.pattern.test(text)) {
          dsStats[ds].errors[errorName] = (dsStats[ds].errors[errorName] || 0) + 1;
        }
      }
    }
  }

  for (const [ds, data] of Object.entries(dsStats).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`\n📦 ${ds} — ${data.total} тикетов`);

    const topErrors = Object.entries(data.errors).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topErrors.length > 0) {
      console.log('   Ошибки:');
      topErrors.forEach(([err, cnt]) => console.log(`   • ${err}: ${cnt}`));
    }

    const topClients = Object.entries(data.clients).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topClients.length > 0) {
      console.log('   Клиенты:', topClients.map(([c, n]) => `${c}(${n})`).join(', '));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // РИСКИ И РЕКОМЕНДАЦИИ
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(80));
  console.log('⚠️ РИСКИ ПО ПРОДУКТУ');
  console.log('═'.repeat(80));

  const risks = [];

  // Критические ошибки
  for (const [errorName, data] of sortedErrors) {
    if (data.config.severity === 'critical' && data.count >= 2) {
      risks.push({
        level: 'CRITICAL',
        text: `${errorName}: ${data.count} тикетов`,
        area: data.config.area,
        action: `Срочно проверить ${data.config.area}`
      });
    }
    if (data.config.severity === 'high' && data.count >= 5) {
      risks.push({
        level: 'HIGH',
        text: `${errorName}: ${data.count} тикетов`,
        area: data.config.area,
        action: `Приоритетно исправить`
      });
    }
  }

  // Клиенты с много проблемами
  for (const [client, data] of sortedClients.slice(0, 3)) {
    if (data.total >= 5) {
      risks.push({
        level: 'MEDIUM',
        text: `Клиент "${client}" с ${data.total} тикетами`,
        area: 'Customer Success',
        action: 'Провести созвон, понять root cause'
      });
    }
  }

  risks.forEach((r, i) => {
    const icon = r.level === 'CRITICAL' ? '🔴' : r.level === 'HIGH' ? '🟠' : '🟡';
    console.log(`\n${i + 1}. ${icon} [${r.level}] ${r.text}`);
    console.log(`   Область: ${r.area}`);
    console.log(`   Действие: ${r.action}`);
  });

  // ═══════════════════════════════════════════════════════════════
  // РЕКОМЕНДАЦИИ
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(80));
  console.log('💡 РЕКОМЕНДАЦИИ ПО УЛУЧШЕНИЮ ПРОДУКТА');
  console.log('═'.repeat(80));

  const recommendations = [];

  if (errorStats['Некорректный интервал доставки']?.count >= 3) {
    recommendations.push({
      area: 'API',
      problem: 'Частые ошибки интервала доставки',
      solution: 'Улучшить валидацию интервалов на фронте + более понятные сообщения об ошибках'
    });
  }

  if (errorStats['ПВЗ не найден']?.count >= 2) {
    recommendations.push({
      area: 'Data',
      problem: 'ПВЗ не найден',
      solution: 'Проверить актуальность справочника ПВЗ, настроить автообновление'
    });
  }

  if (errorStats['Ошибка создания заказа']?.count >= 5) {
    recommendations.push({
      area: 'UX',
      problem: 'Много ошибок создания заказов',
      solution: 'Добавить превью заказа перед отправкой, улучшить валидацию полей'
    });
  }

  if (errorStats['Webhook не работает']?.count >= 2) {
    recommendations.push({
      area: 'Integrations',
      problem: 'Проблемы с webhook\'ами',
      solution: 'Добавить UI для просмотра истории webhook\'ов и retry механизм'
    });
  }

  if (errorStats['Тариф недоступен']?.count >= 2) {
    recommendations.push({
      area: 'Pricing',
      problem: 'Тарифы недоступны',
      solution: 'Показывать причину недоступности тарифа (вес, габариты, направление)'
    });
  }

  recommendations.forEach((r, i) => {
    console.log(`\n${i + 1}. [${r.area}] ${r.problem}`);
    console.log(`   → ${r.solution}`);
  });

  console.log('\n' + '═'.repeat(80));
  console.log('КОНЕЦ ОТЧЁТА');
  console.log('═'.repeat(80));
}

main();
