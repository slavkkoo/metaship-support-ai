/**
 * DASHBOARD DATA GENERATOR
 * Generates JSON data for the Product Health Dashboard
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { config } from 'dotenv';

config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// System errors patterns
const SYSTEM_ERRORS = {
  'Ошибка создания заказа': {
    pattern: /ошибк.*созда|не\s*созда|order.*error|failed.*create/i,
    area: 'Order API',
    severity: 'critical'
  },
  'Timeout/5xx': {
    pattern: /timeout|500|502|503|504|server.*error/i,
    area: 'Infrastructure',
    severity: 'critical'
  },
  'Ошибка авторизации': {
    pattern: /401|403|auth.*error|unauthorized|доступ.*запрещ/i,
    area: 'Auth',
    severity: 'critical'
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
    pattern: /статус.*не.*обновл|не.*приход.*статус|sync.*status/i,
    area: 'Status Sync',
    severity: 'high'
  },
  'Некорректный интервал': {
    pattern: /интервал|interval|некорректно.*интервал|time.*delivery/i,
    area: 'API валидация',
    severity: 'high'
  },
  'Webhook не работает': {
    pattern: /webhook|вебхук|не.*приход.*статус|callback/i,
    area: 'Webhooks',
    severity: 'medium'
  },
  'Этикетка/Накладная': {
    pattern: /этикетк|накладн|label|print.*error/i,
    area: 'Documents',
    severity: 'medium'
  },
  'Ошибка валидации': {
    pattern: /валидац|validation|некорректн.*данн|invalid/i,
    area: 'Data Validation',
    severity: 'medium'
  },
};

// Known clients
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
  [/ozon|озон/i, 'Ozon'],
  [/wildberries|вайлдберриз/i, 'Wildberries'],
  [/lamoda|ламода/i, 'Lamoda'],
];

// Delivery services
const DELIVERY_SERVICES = [
  [/сдек|cdek/i, 'СДЕК'],
  [/dalli|далли/i, 'Dalli'],
  [/почта\s*росси|ems|pochta/i, 'Почта России'],
  [/dpd|дпд/i, 'DPD'],
  [/5post|5пост/i, '5Post'],
  [/boxberry|боксберри/i, 'Boxberry'],
  [/яндекс.*доставк/i, 'Яндекс'],
  [/pony.*express|пони/i, 'Pony Express'],
  [/dostavista|достависта/i, 'Dostavista'],
];

function extractClient(text) {
  if (!text) return null;

  for (const [pattern, name] of KNOWN_CLIENTS) {
    if (pattern.test(text)) return name;
  }

  const ip = text.match(/ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?/);
  if (ip) return ip[0];

  const ooo = text.match(/ООО\s*[«"]?([А-ЯЁа-яё0-9\s\-]+)/);
  if (ooo) return ooo[0].substring(0, 25);

  return null;
}

function extractDS(text) {
  if (!text) return [];
  const ds = [];
  for (const [pattern, name] of DELIVERY_SERVICES) {
    if (pattern.test(text)) ds.push(name);
  }
  return ds;
}

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

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

async function generateDashboardData() {
  console.log('📊 Generating dashboard data...\n');

  // Fetch last 12 weeks of tickets
  const twelveWeeksAgo = new Date();
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84);

  const { data: allTickets, error } = await supabase
    .from('support_tickets')
    .select('*')
    .gte('created_at', twelveWeeksAgo.toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching tickets:', error);
    process.exit(1);
  }

  console.log(`Fetched ${allTickets.length} tickets from last 12 weeks\n`);

  // Current and previous week
  const currentWeek = getWeekRange(0);
  const prevWeek = getWeekRange(1);

  const thisWeekTickets = allTickets.filter(t => {
    const d = new Date(t.created_at);
    return d >= currentWeek.start && d <= currentWeek.end;
  });

  const prevWeekTickets = allTickets.filter(t => {
    const d = new Date(t.created_at);
    return d >= prevWeek.start && d <= prevWeek.end;
  });

  // === KPI CARDS ===
  const totalTickets = thisWeekTickets.length;
  const prevTotalTickets = prevWeekTickets.length;
  const ticketsTrend = prevTotalTickets > 0
    ? ((totalTickets - prevTotalTickets) / prevTotalTickets * 100).toFixed(0)
    : 0;

  const closedTickets = thisWeekTickets.filter(t => t.status === 'closed').length;
  const closeRate = totalTickets > 0 ? (closedTickets / totalTickets * 100).toFixed(1) : 0;
  const prevCloseRate = prevWeekTickets.length > 0
    ? (prevWeekTickets.filter(t => t.status === 'closed').length / prevWeekTickets.length * 100).toFixed(1)
    : 0;
  const closeRateTrend = (closeRate - prevCloseRate).toFixed(1);

  const closingSpeeds = thisWeekTickets
    .filter(t => t.closing_speed && t.closing_speed > 0)
    .map(t => t.closing_speed);
  const avgCloseTime = closingSpeeds.length > 0
    ? (closingSpeeds.reduce((a, b) => a + b, 0) / closingSpeeds.length / 3600).toFixed(1)
    : 0;
  const prevClosingSpeeds = prevWeekTickets
    .filter(t => t.closing_speed && t.closing_speed > 0)
    .map(t => t.closing_speed);
  const prevAvgCloseTime = prevClosingSpeeds.length > 0
    ? (prevClosingSpeeds.reduce((a, b) => a + b, 0) / prevClosingSpeeds.length / 3600).toFixed(1)
    : 0;
  const avgCloseTimeTrend = (avgCloseTime - prevAvgCloseTime).toFixed(1);

  // === SYSTEM ERRORS ===
  const errorStats = {};
  let criticalCount = 0;

  for (const t of thisWeekTickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');

    for (const [errorName, cfg] of Object.entries(SYSTEM_ERRORS)) {
      if (cfg.pattern.test(text)) {
        if (!errorStats[errorName]) {
          errorStats[errorName] = { count: 0, severity: cfg.severity, area: cfg.area };
        }
        errorStats[errorName].count++;
        if (cfg.severity === 'critical') criticalCount++;
      }
    }
  }

  const topIssues = Object.entries(errorStats)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([name, data]) => ({
      name,
      count: data.count,
      severity: data.severity,
      area: data.area
    }));

  // === WEEKLY TREND ===
  const weeklyTrend = [];
  for (let i = 11; i >= 0; i--) {
    const week = getWeekRange(i);
    const weekTickets = allTickets.filter(t => {
      const d = new Date(t.created_at);
      return d >= week.start && d <= week.end;
    });

    const weekNum = getWeekNumber(week.start);
    weeklyTrend.push({
      week: `W${weekNum}`,
      date: week.start.toISOString().split('T')[0],
      count: weekTickets.length,
      closed: weekTickets.filter(t => t.status === 'closed').length
    });
  }

  // === TOP CLIENTS ===
  const clientStats = {};

  for (const t of thisWeekTickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');
    const client = extractClient(text) || t.company_name || t.user_name || 'Unknown';

    if (!clientStats[client]) {
      clientStats[client] = {
        total: 0,
        open: 0,
        errors: {},
        ds: {},
        prevWeekTotal: 0
      };
    }
    clientStats[client].total++;
    if (t.status !== 'closed') clientStats[client].open++;

    // Track errors for client
    for (const [errorName, cfg] of Object.entries(SYSTEM_ERRORS)) {
      if (cfg.pattern.test(text)) {
        clientStats[client].errors[errorName] = (clientStats[client].errors[errorName] || 0) + 1;
      }
    }

    // Track DS for client
    for (const ds of extractDS(text)) {
      clientStats[client].ds[ds] = (clientStats[client].ds[ds] || 0) + 1;
    }
  }

  // Previous week client stats for trend
  for (const t of prevWeekTickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');
    const client = extractClient(text) || t.company_name || t.user_name || 'Unknown';
    if (clientStats[client]) {
      clientStats[client].prevWeekTotal++;
    }
  }

  const topClients = Object.entries(clientStats)
    .filter(([name]) => name !== 'Unknown')
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)
    .map(([name, data]) => {
      const topError = Object.entries(data.errors).sort((a, b) => b[1] - a[1])[0];
      const trend = data.prevWeekTotal > 0
        ? Math.round((data.total - data.prevWeekTotal) / data.prevWeekTotal * 100)
        : (data.total > 0 ? 100 : 0);

      return {
        name,
        tickets: data.total,
        open: data.open,
        mainIssue: topError ? topError[0] : null,
        trend
      };
    });

  // === DELIVERY SERVICES HEALTH ===
  const dsStats = {};

  for (const t of thisWeekTickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');
    const dsList = extractDS(text);

    for (const ds of dsList) {
      if (!dsStats[ds]) {
        dsStats[ds] = { total: 0, errors: {} };
      }
      dsStats[ds].total++;

      for (const [errorName, cfg] of Object.entries(SYSTEM_ERRORS)) {
        if (cfg.pattern.test(text)) {
          dsStats[ds].errors[errorName] = (dsStats[ds].errors[errorName] || 0) + 1;
        }
      }
    }
  }

  const deliveryServices = Object.entries(dsStats)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, data]) => {
      const topError = Object.entries(data.errors).sort((a, b) => b[1] - a[1])[0];
      const status = data.total > 20 ? 'critical' : data.total > 10 ? 'warning' : 'stable';

      return {
        name,
        issues: data.total,
        topProblem: topError ? topError[0] : null,
        status
      };
    });

  // === RISKS ===
  const risks = [];

  // Critical errors
  const criticalErrors = Object.entries(errorStats)
    .filter(([_, data]) => data.severity === 'critical' && data.count >= 2);
  for (const [name, data] of criticalErrors) {
    risks.push({
      level: 'critical',
      title: name,
      description: `${data.count} тикетов в области ${data.area}`,
      count: data.count
    });
  }

  // High severity errors
  const highErrors = Object.entries(errorStats)
    .filter(([_, data]) => data.severity === 'high' && data.count >= 5);
  for (const [name, data] of highErrors) {
    risks.push({
      level: 'high',
      title: name,
      description: `${data.count} тикетов`,
      count: data.count
    });
  }

  // Growing clients
  const growingClients = topClients.filter(c => c.trend >= 50 && c.tickets >= 3);
  for (const client of growingClients) {
    risks.push({
      level: 'medium',
      title: `Рост обращений: ${client.name}`,
      description: `+${client.trend}% vs прошлая неделя`,
      count: client.tickets
    });
  }

  // === RECOMMENDATIONS ===
  const recommendations = [];

  if (errorStats['ПВЗ не найден']?.count >= 3) {
    recommendations.push({
      priority: 1,
      text: `ПВЗ справочник устарел → обновить кеш (${errorStats['ПВЗ не найден'].count} тикетов)`
    });
  }

  if (errorStats['Ошибка создания заказа']?.count >= 3) {
    recommendations.push({
      priority: 2,
      text: `Улучшить валидацию создания заказов (${errorStats['Ошибка создания заказа'].count} тикетов)`
    });
  }

  if (errorStats['Timeout/5xx']?.count >= 2) {
    recommendations.push({
      priority: 1,
      text: `Проверить инфраструктуру — ${errorStats['Timeout/5xx'].count} тикетов с 5xx ошибками`
    });
  }

  if (growingClients.length > 0) {
    recommendations.push({
      priority: 2,
      text: `${growingClients[0].name}: рост +${growingClients[0].trend}% → назначить account manager`
    });
  }

  if (errorStats['Тариф недоступен']?.count >= 3) {
    recommendations.push({
      priority: 3,
      text: `Показывать причину недоступности тарифа в UI (${errorStats['Тариф недоступен'].count} тикетов)`
    });
  }

  // === CHANNELS ===
  const channels = {};
  for (const t of thisWeekTickets) {
    const ch = t.channel || 'unknown';
    channels[ch] = (channels[ch] || 0) + 1;
  }

  const channelStats = Object.entries(channels)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name,
      count,
      percentage: totalTickets > 0 ? Math.round(count / totalTickets * 100) : 0
    }));

  // === BUILD FINAL DATA ===
  const dashboardData = {
    generatedAt: new Date().toISOString(),
    period: {
      start: currentWeek.start.toISOString(),
      end: currentWeek.end.toISOString(),
      weekNumber: getWeekNumber(currentWeek.start),
      year: currentWeek.start.getFullYear()
    },
    kpi: {
      totalTickets: {
        value: totalTickets,
        trend: Number(ticketsTrend),
        trendLabel: `${ticketsTrend > 0 ? '+' : ''}${ticketsTrend}%`
      },
      avgCloseTime: {
        value: Number(avgCloseTime),
        trend: Number(avgCloseTimeTrend),
        trendLabel: `${avgCloseTimeTrend > 0 ? '+' : ''}${avgCloseTimeTrend}h`
      },
      closeRate: {
        value: Number(closeRate),
        trend: Number(closeRateTrend),
        trendLabel: `${closeRateTrend > 0 ? '+' : ''}${closeRateTrend}%`
      },
      criticalIssues: {
        value: criticalErrors.length,
        items: criticalErrors.map(([name]) => name)
      }
    },
    weeklyTrend,
    topIssues,
    topClients,
    deliveryServices,
    risks: risks.slice(0, 6),
    recommendations: recommendations.slice(0, 4),
    channels: channelStats
  };

  // Write to file
  const outputPath = './dashboard/data.json';
  writeFileSync(outputPath, JSON.stringify(dashboardData, null, 2));
  console.log(`✅ Dashboard data written to ${outputPath}\n`);

  // Summary
  console.log('📈 SUMMARY');
  console.log('─'.repeat(40));
  console.log(`Week ${dashboardData.period.weekNumber}, ${dashboardData.period.year}`);
  console.log(`Tickets: ${totalTickets} (${ticketsTrend > 0 ? '+' : ''}${ticketsTrend}%)`);
  console.log(`Close Rate: ${closeRate}%`);
  console.log(`Avg Close Time: ${avgCloseTime}h`);
  console.log(`Critical Issues: ${criticalErrors.length}`);
  console.log(`Top Issues: ${topIssues.slice(0, 3).map(i => i.name).join(', ')}`);
  console.log(`Top Clients: ${topClients.slice(0, 3).map(c => c.name).join(', ')}`);

  return dashboardData;
}

generateDashboardData().catch(console.error);
