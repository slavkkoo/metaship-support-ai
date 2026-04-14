/**
 * WEEKLY COMPARISON ANALYTICS
 * Аналитика за неделю со сравнением с прошлыми неделями
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// СД паттерны
const DS_PATTERNS = [
  { name: 'СДЕК', pattern: /сдек|cdek/i },
  { name: 'Dalli', pattern: /dalli|далли/i },
  { name: 'Почта России', pattern: /почта\s*росси|ems/i },
  { name: 'DPD', pattern: /dpd|дпд/i },
  { name: '5Post', pattern: /5post|5пост/i },
];

// Проблемы паттерны
const ISSUE_PATTERNS = {
  'Создание заказа': /создан|не\s*созда|ошибк.*заказ|order.*error/i,
  'ПВЗ не найден': /пвз.*не\s*найден|точка.*не\s*найден/i,
  'API ошибка': /api.*ошибк|error.*api|400|401|500/i,
  'Статусы': /статус.*не.*обновл|sync/i,
  'Интервал доставки': /интервал|время.*доставк/i,
  'Тариф': /тариф|расчёт|стоимость/i,
};

// Клиенты паттерны
const CLIENT_PATTERNS = [
  [/валта/i, 'ВАЛТА'],
  [/кма|kma/i, 'КМА'],
  [/лаки|lucky/i, 'Лаки'],
  [/intercosmetology/i, 'Intercosmetology'],
  [/citilink|ситилинк/i, 'Citilink'],
  [/майдент|mydent/i, 'МайДент24'],
  [/ИП\s+[А-ЯЁ][а-яё]+/, null], // dynamic
  [/ООО\s*[«"]?[А-ЯЁа-яё\s]+/, null], // dynamic
];

function extractClient(text) {
  if (!text) return null;

  for (const [pattern, name] of CLIENT_PATTERNS) {
    if (name && pattern.test(text)) return name;
  }

  const ip = text.match(/ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?/);
  if (ip) return ip[0];

  const ooo = text.match(/ООО\s*[«"]?([А-ЯЁа-яё0-9\s\-]+)/);
  if (ooo) return ooo[0].substring(0, 25);

  return null;
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

function analyzeWeek(tickets) {
  const stats = {
    total: tickets.length,
    closed: 0,
    open: 0,
    channels: {},
    priorities: {},
    deliveryServices: {},
    issues: {},
    clients: {},
    avgClosingSpeed: null,
  };

  let totalSpeed = 0;
  let speedCount = 0;

  for (const t of tickets) {
    if (t.status === 'closed') stats.closed++;
    else stats.open++;

    stats.channels[t.channel || 'unknown'] = (stats.channels[t.channel || 'unknown'] || 0) + 1;
    stats.priorities[t.priority || 'unknown'] = (stats.priorities[t.priority || 'unknown'] || 0) + 1;

    if (t.closing_speed > 0) {
      totalSpeed += t.closing_speed;
      speedCount++;
    }

    const text = (t.subject || '') + ' ' + (t.first_message_text || '');

    // СД
    for (const ds of DS_PATTERNS) {
      if (ds.pattern.test(text)) {
        stats.deliveryServices[ds.name] = (stats.deliveryServices[ds.name] || 0) + 1;
      }
    }

    // Проблемы
    for (const [issue, pattern] of Object.entries(ISSUE_PATTERNS)) {
      if (pattern.test(text)) {
        stats.issues[issue] = (stats.issues[issue] || 0) + 1;
      }
    }

    // Клиенты
    const client = extractClient(text);
    if (client) {
      stats.clients[client] = (stats.clients[client] || 0) + 1;
    }
  }

  if (speedCount > 0) {
    stats.avgClosingSpeed = (totalSpeed / speedCount / 3600).toFixed(1);
  }

  stats.closedRate = stats.total > 0 ? ((stats.closed / stats.total) * 100).toFixed(0) : 0;

  return stats;
}

function trend(current, previous) {
  if (previous === 0) return current > 0 ? '🆕 new' : '—';
  const diff = current - previous;
  const pct = ((diff / previous) * 100).toFixed(0);
  if (diff > 0) return `↑ +${diff} (+${pct}%)`;
  if (diff < 0) return `↓ ${diff} (${pct}%)`;
  return '→ 0%';
}

async function main() {
  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false });

  // Группируем по неделям
  const weeks = {};
  for (const t of tickets) {
    const weekStart = getWeekStart(t.created_at);
    const key = formatDate(weekStart);
    if (!weeks[key]) weeks[key] = [];
    weeks[key].push(t);
  }

  const sortedWeeks = Object.keys(weeks).sort().reverse();
  const currentWeekKey = sortedWeeks[0];
  const prevWeekKey = sortedWeeks[1];
  const prev2WeekKey = sortedWeeks[2];

  const currentWeek = analyzeWeek(weeks[currentWeekKey] || []);
  const prevWeek = analyzeWeek(weeks[prevWeekKey] || []);
  const prev2Week = analyzeWeek(weeks[prev2WeekKey] || []);

  // Средние за 4 недели
  const last4Weeks = sortedWeeks.slice(0, 4).map(k => analyzeWeek(weeks[k] || []));
  const avgTotal = (last4Weeks.reduce((s, w) => s + w.total, 0) / last4Weeks.length).toFixed(0);

  console.log('═'.repeat(70));
  console.log('ЕЖЕНЕДЕЛЬНЫЙ ОТЧЁТ ПО ТИКЕТАМ ПОДДЕРЖКИ');
  console.log('═'.repeat(70));
  console.log(`Текущая неделя: ${currentWeekKey} (${currentWeek.total} тикетов)`);
  console.log(`Прошлая неделя: ${prevWeekKey} (${prevWeek.total} тикетов)`);
  console.log(`Средняя за 4 недели: ${avgTotal} тикетов`);

  // Ключевые метрики
  console.log('\n' + '─'.repeat(70));
  console.log('📊 КЛЮЧЕВЫЕ МЕТРИКИ');
  console.log('─'.repeat(70));
  console.log(`Тикетов:        ${currentWeek.total.toString().padStart(4)}  ${trend(currentWeek.total, prevWeek.total)}`);
  console.log(`Закрыто:        ${currentWeek.closed.toString().padStart(4)}  (${currentWeek.closedRate}%) ${trend(currentWeek.closed, prevWeek.closed)}`);
  console.log(`Открыто:        ${currentWeek.open.toString().padStart(4)}  ${trend(currentWeek.open, prevWeek.open)}`);
  console.log(`Ср. закрытие:   ${(currentWeek.avgClosingSpeed || '—').toString().padStart(4)}ч`);

  // Каналы
  console.log('\n' + '─'.repeat(70));
  console.log('📱 КАНАЛЫ');
  console.log('─'.repeat(70));
  const allChannels = new Set([...Object.keys(currentWeek.channels), ...Object.keys(prevWeek.channels)]);
  for (const ch of allChannels) {
    const curr = currentWeek.channels[ch] || 0;
    const prev = prevWeek.channels[ch] || 0;
    console.log(`${ch.padEnd(15)} ${curr.toString().padStart(3)}  ${trend(curr, prev)}`);
  }

  // СД
  console.log('\n' + '─'.repeat(70));
  console.log('🚚 СЛУЖБЫ ДОСТАВКИ (проблемы)');
  console.log('─'.repeat(70));
  const allDS = new Set([...Object.keys(currentWeek.deliveryServices), ...Object.keys(prevWeek.deliveryServices)]);
  for (const ds of [...allDS].sort((a, b) => (currentWeek.deliveryServices[b] || 0) - (currentWeek.deliveryServices[a] || 0))) {
    const curr = currentWeek.deliveryServices[ds] || 0;
    const prev = prevWeek.deliveryServices[ds] || 0;
    if (curr > 0 || prev > 0) {
      console.log(`${ds.padEnd(15)} ${curr.toString().padStart(3)}  ${trend(curr, prev)}`);
    }
  }

  // Типы проблем
  console.log('\n' + '─'.repeat(70));
  console.log('🔧 ТИПЫ ПРОБЛЕМ');
  console.log('─'.repeat(70));
  const allIssues = new Set([...Object.keys(currentWeek.issues), ...Object.keys(prevWeek.issues)]);
  for (const issue of [...allIssues].sort((a, b) => (currentWeek.issues[b] || 0) - (currentWeek.issues[a] || 0))) {
    const curr = currentWeek.issues[issue] || 0;
    const prev = prevWeek.issues[issue] || 0;
    console.log(`${issue.padEnd(20)} ${curr.toString().padStart(3)}  ${trend(curr, prev)}`);
  }

  // Топ клиенты
  console.log('\n' + '─'.repeat(70));
  console.log('👥 ТОП КЛИЕНТЫ (с проблемами)');
  console.log('─'.repeat(70));
  const sortedClients = Object.entries(currentWeek.clients).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [client, count] of sortedClients) {
    const prev = prevWeek.clients[client] || 0;
    console.log(`${client.substring(0, 22).padEnd(23)} ${count.toString().padStart(3)}  ${trend(count, prev)}`);
  }

  // Открытые тикеты
  const openTickets = (weeks[currentWeekKey] || []).filter(t => t.status !== 'closed');
  if (openTickets.length > 0) {
    console.log('\n' + '─'.repeat(70));
    console.log(`⚠️  ОТКРЫТЫЕ ТИКЕТЫ (${openTickets.length})`);
    console.log('─'.repeat(70));
    for (const t of openTickets) {
      const client = extractClient((t.subject || '') + ' ' + (t.first_message_text || '')) || t.user_name || 'Unknown';
      const subject = (t.subject || '').substring(0, 40);
      console.log(`#${t.ticket_id} ${client.substring(0, 18).padEnd(19)} ${subject}`);
    }
  }

  // Выводы и риски
  console.log('\n' + '═'.repeat(70));
  console.log('💡 ВЫВОДЫ И РИСКИ');
  console.log('═'.repeat(70));

  // Рост тикетов
  if (currentWeek.total > prevWeek.total * 1.2) {
    console.log(`⚠️  Рост тикетов на ${((currentWeek.total / prevWeek.total - 1) * 100).toFixed(0)}% относительно прошлой недели`);
  } else if (currentWeek.total < prevWeek.total * 0.8) {
    console.log(`✅ Снижение тикетов на ${((1 - currentWeek.total / prevWeek.total) * 100).toFixed(0)}% — хороший знак`);
  }

  // Открытые тикеты
  if (currentWeek.open > prevWeek.open) {
    console.log(`⚠️  Больше открытых тикетов: ${currentWeek.open} vs ${prevWeek.open} на прошлой неделе`);
  }

  // Проблемные СД
  for (const ds of Object.keys(currentWeek.deliveryServices)) {
    const curr = currentWeek.deliveryServices[ds] || 0;
    const prev = prevWeek.deliveryServices[ds] || 0;
    if (curr > prev * 1.5 && curr >= 3) {
      console.log(`🚚 Рост проблем по ${ds}: ${prev} → ${curr} (+${curr - prev})`);
    }
  }

  // Проблемные клиенты
  for (const [client, count] of sortedClients.slice(0, 5)) {
    const prev = prevWeek.clients[client] || 0;
    if (count > prev * 1.5 && count >= 3) {
      console.log(`👤 Клиент "${client}" требует внимания: ${prev} → ${count} тикетов`);
    }
  }

  // Новые проблемы
  for (const issue of Object.keys(currentWeek.issues)) {
    const curr = currentWeek.issues[issue] || 0;
    const prev = prevWeek.issues[issue] || 0;
    if (curr > prev * 1.5 && curr >= 3) {
      console.log(`🔧 Рост "${issue}": ${prev} → ${curr}`);
    }
  }

  console.log('\n' + '═'.repeat(70));
}

main();
