/**
 * ANALYTICS BY DELIVERY SERVICE
 * Какие КЛИЕНТЫ имеют проблемы с какими СД
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Службы доставки
const DELIVERY_SERVICES = [
  { name: 'СДЕК', pattern: /сдек|cdek/i },
  { name: 'Dalli', pattern: /dalli|далли/i },
  { name: 'Почта России', pattern: /почта\s*росси|ems|pochta/i },
  { name: 'DPD', pattern: /dpd|дпд/i },
  { name: 'Boxberry', pattern: /boxberry|боксберри/i },
  { name: '5Post', pattern: /5post|5пост|пятёрочка/i },
  { name: 'ПЭК', pattern: /пэк|pek/i },
  { name: 'Яндекс Доставка', pattern: /яндекс.*доставк|yandex.*deliver/i },
];

// Извлечение клиента из текста
function extractClient(text) {
  if (!text) return null;

  // ИП
  const ip = text.match(/ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?/);
  if (ip) return ip[0];

  // ООО
  const ooo = text.match(/ООО\s*[«"]?([А-ЯЁA-Za-zа-яё0-9\s\-\.]+)[»"]?/);
  if (ooo) return ooo[0].replace(/[«»""]/g, '').trim().substring(0, 30);

  // Известные клиенты
  const known = [
    [/валта/i, 'ВАЛТА'],
    [/кма|kma/i, 'КМА'],
    [/лаки|lucky/i, 'Лаки'],
    [/intercosmetology/i, 'Intercosmetology'],
    [/citilink|ситилинк/i, 'Citilink'],
    [/майдент|mydent/i, 'МайДент24'],
    [/алискеров/i, 'ИП Алискерова'],
    [/амирасланов/i, 'ИП Амирасланов'],
    [/смарт\s*дс/i, 'Смарт ДС Рус'],
    [/ozon|озон/i, 'Ozon'],
    [/wildberries|wb/i, 'Wildberries'],
    [/lamoda|ламода/i, 'Lamoda'],
    [/улыбка\s*радуги/i, 'Улыбка Радуги'],
    [/insales/i, 'InSales'],
    [/мегамаркет/i, 'МегаМаркет'],
  ];

  for (const [pattern, name] of known) {
    if (pattern.test(text)) return name;
  }

  return null;
}

// Определить СД из текста
function extractDeliveryService(text) {
  if (!text) return [];
  const found = [];
  for (const ds of DELIVERY_SERVICES) {
    if (ds.pattern.test(text)) {
      found.push(ds.name);
    }
  }
  return found;
}

async function main() {
  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false });

  console.log('='.repeat(70));
  console.log('АНАЛИТИКА: КЛИЕНТЫ И СЛУЖБЫ ДОСТАВКИ');
  console.log('='.repeat(70));

  // Структура: { СД: { клиент: { tickets: [], ... } } }
  const dsStats = {};

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');
    const deliveryServices = extractDeliveryService(text);

    if (deliveryServices.length === 0) continue;

    let client = extractClient(text);
    if (!client) {
      // Используем отправителя как клиента
      client = t.company_name || t.user_name;
      if (client && DELIVERY_SERVICES.some(ds => ds.pattern.test(client))) {
        client = null; // Это СД, а не клиент
      }
    }
    if (!client) client = 'Неизвестный клиент';

    for (const ds of deliveryServices) {
      if (!dsStats[ds]) dsStats[ds] = {};
      if (!dsStats[ds][client]) {
        dsStats[ds][client] = { total: 0, open: 0, tickets: [] };
      }
      dsStats[ds][client].total++;
      if (t.status !== 'closed') dsStats[ds][client].open++;
      dsStats[ds][client].tickets.push({
        id: t.ticket_id,
        status: t.status,
        subject: (t.subject || '').substring(0, 45),
        date: t.created_at.split('T')[0]
      });
    }
  }

  // Выводим по каждой СД
  for (const [ds, clients] of Object.entries(dsStats).sort((a, b) => {
    const totalA = Object.values(a[1]).reduce((s, c) => s + c.total, 0);
    const totalB = Object.values(b[1]).reduce((s, c) => s + c.total, 0);
    return totalB - totalA;
  })) {
    const totalTickets = Object.values(clients).reduce((s, c) => s + c.total, 0);
    const totalOpen = Object.values(clients).reduce((s, c) => s + c.open, 0);

    console.log('\n' + '═'.repeat(70));
    console.log(`🚚 СД: ${ds} | Всего тикетов: ${totalTickets} | Открыто: ${totalOpen}`);
    console.log('═'.repeat(70));

    const sortedClients = Object.entries(clients).sort((a, b) => b[1].total - a[1].total);

    console.log('\n📊 Клиенты с проблемами по этой СД:');
    console.log('-'.repeat(50));

    sortedClients.forEach(([client, stats], i) => {
      const openMark = stats.open > 0 ? ` ⚠️ ${stats.open} откр` : '';
      console.log(`${(i + 1).toString().padStart(2)}. ${client.padEnd(28)} ${stats.total.toString().padStart(2)} тикетов${openMark}`);
    });

    // Топ-3 клиента с деталями
    console.log('\n📋 Детали по топ клиентам:');
    sortedClients.slice(0, 3).forEach(([client, stats]) => {
      console.log(`\n   🏢 ${client}:`);
      stats.tickets.slice(0, 3).forEach(t => {
        const icon = t.status === 'closed' ? '✅' : '🔴';
        console.log(`      ${icon} #${t.id} ${t.subject}`);
      });
      if (stats.tickets.length > 3) {
        console.log(`      ... и ещё ${stats.tickets.length - 3} тикетов`);
      }
    });
  }

  console.log('\n' + '═'.repeat(70));
}

main();
