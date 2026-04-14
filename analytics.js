/**
 * TICKET ANALYTICS
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false });

  console.log('='.repeat(60));
  console.log('АНАЛИТИКА ПО ТИКЕТАМ ПОДДЕРЖКИ');
  console.log('Период: последние 30 дней');
  console.log('='.repeat(60));

  // 1. Общая статистика
  const total = tickets.length;
  const closed = tickets.filter(t => t.status === 'closed').length;
  const open = total - closed;

  console.log('\n📊 ОБЩАЯ СТАТИСТИКА');
  console.log('-'.repeat(40));
  console.log('Всего тикетов:', total);
  console.log('Закрыто:', closed, '(' + (closed/total*100).toFixed(1) + '%)');
  console.log('Открыто:', open, '(' + (open/total*100).toFixed(1) + '%)');

  // Среднее время закрытия
  const closingSpeeds = tickets.filter(t => t.closing_speed > 0).map(t => t.closing_speed);
  if (closingSpeeds.length > 0) {
    const avgSeconds = closingSpeeds.reduce((a,b) => a+b, 0) / closingSpeeds.length;
    console.log('Среднее время закрытия:', (avgSeconds/3600).toFixed(1), 'часов');
  }

  // 2. По каналам
  console.log('\n📱 КАНАЛЫ ОБРАЩЕНИЙ');
  console.log('-'.repeat(40));
  const channels = {};
  tickets.forEach(t => { channels[t.channel || 'unknown'] = (channels[t.channel || 'unknown'] || 0) + 1; });
  Object.entries(channels).sort((a,b) => b[1]-a[1]).forEach(([ch, cnt]) => {
    const pct = (cnt/total*100).toFixed(1);
    const bar = '█'.repeat(Math.round(cnt/total*20));
    console.log(ch.padEnd(12), cnt.toString().padStart(4), '(' + pct + '%)', bar);
  });

  // 3. По приоритетам
  console.log('\n🎯 ПРИОРИТЕТЫ');
  console.log('-'.repeat(40));
  const priorities = {};
  tickets.forEach(t => { priorities[t.priority || 'unknown'] = (priorities[t.priority || 'unknown'] || 0) + 1; });
  const prioOrder = ['critical', 'high', 'normal', 'low', 'unknown'];
  prioOrder.forEach(p => {
    if (priorities[p]) {
      const pct = (priorities[p]/total*100).toFixed(1);
      console.log(p.padEnd(12), priorities[p].toString().padStart(4), '(' + pct + '%)');
    }
  });

  // 4. ТОП клиентов
  console.log('\n👥 ТОП-15 КЛИЕНТОВ');
  console.log('-'.repeat(40));
  const clients = {};
  tickets.forEach(t => {
    const client = t.company_name || t.user_name || 'Unknown';
    if (!clients[client]) clients[client] = { total: 0, closed: 0, open: 0 };
    clients[client].total++;
    if (t.status === 'closed') clients[client].closed++;
    else clients[client].open++;
  });
  Object.entries(clients)
    .sort((a,b) => b[1].total - a[1].total)
    .slice(0, 15)
    .forEach(([name, stats], i) => {
      console.log((i+1).toString().padStart(2) + '.', name.substring(0,25).padEnd(26),
        stats.total.toString().padStart(3), 'тикетов',
        stats.open > 0 ? '(открыто: ' + stats.open + ')' : '');
    });

  // 5. Анализ проблем
  console.log('\n🔍 ТИПЫ ПРОБЛЕМ (по ключевым словам)');
  console.log('-'.repeat(40));
  const issuePatterns = {
    'API/Интеграции': /api|интеграц|webhook|подключ/i,
    'ПВЗ/Точки выдачи': /пвз|точк|pvz|пункт выдачи|pickup/i,
    'Статусы/Трекинг': /статус|sync|синхрониз|трек/i,
    'Тарифы/Расчёты': /тариф|расчёт|calculation|стоимость/i,
    'Создание заказов': /создан|заказ|order|ошибк/i,
    'СДЕК': /cdek|сдек/i,
    'Яндекс': /яндекс|yandex/i,
    'Почта России': /почта|pochta|ems/i,
    'Bitrix/Модули': /bitrix|битрикс|модуль/i,
    'Dalli': /dalli|далли/i,
    'Boxberry': /boxberry|боксберри/i,
    'DPD': /dpd|дпд/i,
  };
  const issues = {};
  tickets.forEach(t => {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');
    for (const [key, pattern] of Object.entries(issuePatterns)) {
      if (pattern.test(text)) {
        issues[key] = (issues[key] || 0) + 1;
      }
    }
  });
  Object.entries(issues)
    .sort((a,b) => b[1]-a[1])
    .forEach(([type, cnt]) => {
      const pct = (cnt/total*100).toFixed(1);
      const bar = '▓'.repeat(Math.round(cnt/5));
      console.log(type.padEnd(20), cnt.toString().padStart(4), '(' + pct + '%)', bar);
    });

  // 6. Тренды по неделям
  console.log('\n📈 ТРЕНД ПО НЕДЕЛЯМ');
  console.log('-'.repeat(40));
  const weeks = {};
  tickets.forEach(t => {
    const date = new Date(t.created_at);
    const weekStart = new Date(date);
    const day = weekStart.getDay();
    const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
    weekStart.setDate(diff);
    const key = weekStart.toISOString().split('T')[0];
    if (!weeks[key]) weeks[key] = { total: 0, closed: 0 };
    weeks[key].total++;
    if (t.status === 'closed') weeks[key].closed++;
  });
  Object.entries(weeks)
    .sort((a,b) => a[0].localeCompare(b[0]))
    .forEach(([week, stats]) => {
      const rate = (stats.closed/stats.total*100).toFixed(0);
      const bar = '█'.repeat(Math.round(stats.total/5));
      console.log(week, stats.total.toString().padStart(3), 'тикетов', (rate + '%').padStart(4), 'closed', bar);
    });

  // 7. Открытые тикеты
  const openTickets = tickets.filter(t => t.status !== 'closed');
  console.log('\n⚠️  ОТКРЫТЫЕ ТИКЕТЫ (' + openTickets.length + ')');
  console.log('-'.repeat(40));
  openTickets
    .slice(0, 10)
    .forEach(t => {
      const client = (t.company_name || t.user_name || 'Unknown').substring(0, 18);
      const subject = (t.subject || 'Без темы').substring(0, 40);
      const days = Math.floor((Date.now() - new Date(t.created_at)) / 86400000);
      console.log('#' + t.ticket_id, client.padEnd(19), days + 'д', subject);
    });

  // 8. Риски и рекомендации
  console.log('\n🚨 РИСКИ И РЕКОМЕНДАЦИИ');
  console.log('-'.repeat(40));

  if (open > total * 0.1) {
    console.log('⚠️  Высокий % открытых тикетов:', (open/total*100).toFixed(1) + '%');
  } else {
    console.log('✅ Процент открытых тикетов в норме:', (open/total*100).toFixed(1) + '%');
  }

  const topClients = Object.entries(clients).sort((a,b) => b[1].total - a[1].total);
  if (topClients[0] && topClients[0][1].total > 10) {
    console.log('👀 Частый клиент:', topClients[0][0], '(' + topClients[0][1].total + ' тикетов) - рассмотреть персонального менеджера');
  }

  const topIssues = Object.entries(issues).sort((a,b) => b[1]-a[1]);
  if (topIssues[0] && topIssues[0][1] > 15) {
    console.log('🔧 Топ проблема:', topIssues[0][0], '(' + topIssues[0][1] + ') - улучшить документацию/UX');
  }

  // Клиенты с открытыми тикетами
  const clientsWithOpen = Object.entries(clients)
    .filter(([_, s]) => s.open > 0)
    .sort((a,b) => b[1].open - a[1].open);
  if (clientsWithOpen.length > 0) {
    console.log('📋 Клиенты с открытыми тикетами:', clientsWithOpen.map(([n, s]) => n + '(' + s.open + ')').slice(0,5).join(', '));
  }

  console.log('\n' + '='.repeat(60));
}

main().catch(console.error);
