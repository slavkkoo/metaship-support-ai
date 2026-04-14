/**
 * WEEKLY REPORTS GENERATOR
 * Генерирует понедельные отчёты и сохраняет в БД
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Создаём таблицу если её нет
async function createTableIfNeeded() {
  const { error } = await supabase.rpc('exec_sql', {
    query: `
      CREATE TABLE IF NOT EXISTS weekly_reports (
        id BIGSERIAL PRIMARY KEY,
        week_start DATE NOT NULL,
        week_end DATE NOT NULL,
        week_number INTEGER,
        year INTEGER,
        total_tickets INTEGER DEFAULT 0,
        closed_tickets INTEGER DEFAULT 0,
        open_tickets INTEGER DEFAULT 0,
        avg_closing_time_hours NUMERIC(10,2),
        channels_breakdown JSONB,
        priority_breakdown JSONB,
        top_clients JSONB,
        top_issues JSONB,
        executive_summary TEXT,
        risks JSONB,
        recommendations JSONB,
        full_report JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(week_start, week_end)
      );
    `
  });

  // Если rpc не работает, таблица должна быть создана вручную
  if (error) {
    console.log('Note: Create table manually using schema-weekly-reports.sql');
  }
}

// Получить все тикеты
async function getAllTickets() {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

// Группировка тикетов по неделям
function groupByWeek(tickets) {
  const weeks = new Map();

  for (const ticket of tickets) {
    const date = new Date(ticket.created_at);
    // Начало недели (понедельник)
    const weekStart = new Date(date);
    const day = weekStart.getDay();
    const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
    weekStart.setDate(diff);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const key = weekStart.toISOString().split('T')[0];

    if (!weeks.has(key)) {
      weeks.set(key, {
        week_start: weekStart,
        week_end: weekEnd,
        tickets: []
      });
    }
    weeks.get(key).tickets.push(ticket);
  }

  return Array.from(weeks.values()).sort((a, b) => b.week_start - a.week_start);
}

// Анализ недели
function analyzeWeek(weekData) {
  const { tickets, week_start, week_end } = weekData;

  // Базовые метрики
  const total = tickets.length;
  const closed = tickets.filter(t => t.status === 'closed').length;
  const open = total - closed;

  // Среднее время закрытия
  const closingSpeeds = tickets
    .filter(t => t.closing_speed && t.closing_speed > 0)
    .map(t => t.closing_speed);
  const avgClosingHours = closingSpeeds.length > 0
    ? (closingSpeeds.reduce((a, b) => a + b, 0) / closingSpeeds.length / 3600)
    : null;

  // Каналы
  const channels = {};
  tickets.forEach(t => {
    channels[t.channel || 'unknown'] = (channels[t.channel || 'unknown'] || 0) + 1;
  });

  // Приоритеты
  const priorities = {};
  tickets.forEach(t => {
    priorities[t.priority || 'unknown'] = (priorities[t.priority || 'unknown'] || 0) + 1;
  });

  // ТОП клиентов
  const clients = {};
  tickets.forEach(t => {
    const client = t.company_name || t.user_name || 'Unknown';
    clients[client] = (clients[client] || 0) + 1;
  });
  const topClients = Object.entries(clients)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Анализ проблем по ключевым словам в subject
  const issuePatterns = {
    'api_integration': /api|интеграц|webhook/i,
    'delivery_point': /пвз|точк|pvz|пункт выдачи/i,
    'status_sync': /статус|sync|синхрониз/i,
    'tariff_calculation': /тариф|расчёт|calculation/i,
    'order_creation': /создан|заказ|order.*creat/i,
    'cdek_issues': /cdek|сдек/i,
    'yandex_issues': /яндекс|yandex/i,
    'bitrix_module': /bitrix|битрикс|модуль/i,
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

  const topIssues = Object.entries(issues)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));

  // Генерация саммари
  const closedRate = ((closed / total) * 100).toFixed(0);
  const topChannel = Object.entries(channels).sort((a, b) => b[1] - a[1])[0];
  const topClient = topClients[0];

  let summary = `За неделю ${week_start.toLocaleDateString('ru-RU')} - ${week_end.toLocaleDateString('ru-RU')}: `;
  summary += `${total} тикетов (${closed} закрыто, ${closedRate}%). `;
  if (topChannel) summary += `Основной канал: ${topChannel[0]} (${topChannel[1]}). `;
  if (topClient) summary += `Топ клиент: ${topClient.name} (${topClient.count} тикетов). `;
  if (avgClosingHours) summary += `Среднее время закрытия: ${avgClosingHours.toFixed(1)}ч.`;

  // Риски
  const risks = [];
  if (open > closed) {
    risks.push({ type: 'high_open_rate', message: `Много открытых тикетов: ${open} из ${total}`, severity: 'high' });
  }
  if (avgClosingHours && avgClosingHours > 24) {
    risks.push({ type: 'slow_resolution', message: `Медленное закрытие: ${avgClosingHours.toFixed(1)}ч в среднем`, severity: 'medium' });
  }
  const highPriority = priorities['high'] || 0 + priorities['critical'] || 0;
  if (highPriority > total * 0.2) {
    risks.push({ type: 'high_priority_volume', message: `${highPriority} тикетов с высоким приоритетом`, severity: 'high' });
  }

  // Рекомендации
  const recommendations = [];
  if (topIssues.length > 0 && topIssues[0].count > 3) {
    recommendations.push({
      area: topIssues[0].type,
      action: `Проверить повторяющуюся проблему "${topIssues[0].type}" (${topIssues[0].count} тикетов)`
    });
  }
  if (topClient && topClient.count > 5) {
    recommendations.push({
      area: 'client_attention',
      action: `Обратить внимание на клиента "${topClient.name}" - ${topClient.count} обращений`
    });
  }

  // Получаем номер недели
  const startOfYear = new Date(week_start.getFullYear(), 0, 1);
  const weekNumber = Math.ceil(((week_start - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);

  return {
    week_start_date: week_start.toISOString().split('T')[0],
    week_end_date: week_end.toISOString().split('T')[0],
    report_json: {
      executive_summary: summary,
      week_number: weekNumber,
      year: week_start.getFullYear(),
      metrics: {
        total_tickets: total,
        closed_tickets: closed,
        open_tickets: open,
        closed_rate: ((closed / total) * 100).toFixed(1) + '%',
        avg_closing_hours: avgClosingHours ? avgClosingHours.toFixed(1) : null
      },
      channels_breakdown: channels,
      priority_breakdown: priorities,
      top_clients: topClients,
      top_issues: topIssues,
      risks,
      recommendations,
      ticket_ids: tickets.map(t => t.ticket_id)
    }
  };
}

// Сохранение отчёта
async function saveReport(report) {
  const { data, error } = await supabase
    .from('weekly_reports')
    .upsert(report, { onConflict: 'week_start_date' })
    .select();

  if (error) {
    console.error(`Error saving report for ${report.week_start_date}:`, error.message);
    return false;
  }
  return true;
}

// Main
async function main() {
  console.log('='.repeat(50));
  console.log('WEEKLY REPORTS GENERATOR');
  console.log('='.repeat(50));

  // Получаем все тикеты
  console.log('\nFetching tickets...');
  const tickets = await getAllTickets();
  console.log(`Found ${tickets.length} tickets`);

  // Группируем по неделям
  console.log('\nGrouping by weeks...');
  const weeks = groupByWeek(tickets);
  console.log(`Found ${weeks.length} weeks`);

  // Генерируем и сохраняем отчёты
  console.log('\nGenerating reports...');

  for (const weekData of weeks) {
    const report = analyzeWeek(weekData);
    console.log(`\n--- Week ${report.week_start_date} to ${report.week_end_date} ---`);
    console.log(`Tickets: ${report.report_json.metrics.total_tickets} (${report.report_json.metrics.closed_tickets} closed)`);
    console.log(`Summary: ${report.report_json.executive_summary}`);

    const saved = await saveReport(report);
    if (saved) {
      console.log('✓ Saved to database');
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('DONE');
  console.log('='.repeat(50));
}

main().catch(console.error);
