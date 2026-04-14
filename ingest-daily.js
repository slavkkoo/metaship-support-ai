/**
 * DAILY TICKET INGESTION
 * Загружает тикеты за последние 24 часа
 *
 * Запуск: node ingest-daily.js
 * Или с параметром: node ingest-daily.js --days=3
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from script directory
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

// Parse --days argument
const daysArg = process.argv.find(a => a.startsWith('--days='));
const DAYS_TO_FETCH = daysArg ? parseInt(daysArg.split('=')[1]) : 1;

const CONFIG = {
  omnidesk: {
    baseUrl: 'https://pimpay.omnidesk.ru/api',
    email: process.env.OMNIDESK_EMAIL,
    apiToken: process.env.OMNIDESK_API_TOKEN,
    rateLimitDelay: 200,
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
};

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

function getAuthHeader() {
  const credentials = `${CONFIG.omnidesk.email}:${CONFIG.omnidesk.apiToken}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiRequest(endpoint, retries = 3) {
  const url = `${CONFIG.omnidesk.baseUrl}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
  });

  if (response.status === 429 && retries > 0) {
    await sleep((4 - retries) * 2000);
    return apiRequest(endpoint, retries - 1);
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

async function fetchTickets(cutoffDate) {
  const tickets = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 20) {
    const response = await apiRequest(`/cases.json?limit=100&page=${page}&sort=created_at&order=desc`);
    const keys = Object.keys(response).filter(k => !isNaN(parseInt(k)));

    if (keys.length === 0) break;

    let olderCount = 0;
    for (const key of keys) {
      const ticket = response[key].case || response[key];
      const createdAt = new Date(ticket.created_at);
      if (createdAt >= cutoffDate) {
        tickets.push(ticket);
      } else {
        olderCount++;
      }
    }

    if (olderCount === keys.length || keys.length < 100) {
      hasMore = false;
    } else {
      page++;
      await sleep(CONFIG.omnidesk.rateLimitDelay);
    }
  }
  return tickets;
}

async function fetchUser(userId) {
  try {
    const response = await apiRequest(`/users/${userId}.json`);
    const user = response.user || response;
    return {
      user_name: user.user_full_name || null,
      user_email: user.user_email || user.user_screen_name || null,
      company_name: user.company_name || null,
    };
  } catch {
    return { user_name: null, user_email: null, company_name: null };
  }
}

async function fetchFirstMessage(ticketId) {
  try {
    const response = await apiRequest(`/cases/${ticketId}/messages.json`);
    const keys = Object.keys(response).filter(k => !isNaN(parseInt(k)));
    if (keys.length === 0) return null;

    const messages = keys.map(k => response[k].message || response[k]);
    messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const customerMsg = messages.find(m => !m.staff_id && !m.note);
    const msg = customerMsg || messages[0];

    let text = msg?.content || msg?.content_html || null;
    if (text) {
      text = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
    }
    return text;
  } catch {
    return null;
  }
}

function parseDate(dateStr) {
  if (!dateStr || dateStr === '-') return null;
  try { return new Date(dateStr).toISOString(); } catch { return null; }
}

async function main() {
  const startTime = Date.now();
  log(`=== DAILY INGESTION (last ${DAYS_TO_FETCH} day(s)) ===`);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DAYS_TO_FETCH);
  log(`Cutoff: ${cutoffDate.toISOString()}`);

  const supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.key);

  // Fetch tickets
  const tickets = await fetchTickets(cutoffDate);
  log(`Found ${tickets.length} tickets`);

  if (tickets.length === 0) {
    log('No new tickets. Done.');
    return;
  }

  // Process tickets
  const records = [];
  const userCache = new Map();

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    const ticketId = t.case_id || t.id;

    // Fetch user (cached)
    let userInfo = { user_name: null, user_email: null, company_name: null };
    if (t.user_id) {
      if (userCache.has(t.user_id)) {
        userInfo = userCache.get(t.user_id);
      } else {
        userInfo = await fetchUser(t.user_id);
        userCache.set(t.user_id, userInfo);
        await sleep(CONFIG.omnidesk.rateLimitDelay);
      }
    }

    const firstMessage = await fetchFirstMessage(ticketId);
    await sleep(CONFIG.omnidesk.rateLimitDelay);

    records.push({
      ticket_id: parseInt(ticketId),
      case_number: t.case_number || null,
      created_at: parseDate(t.created_at),
      closed_at: parseDate(t.closed_at),
      updated_at: parseDate(t.updated_at),
      status: t.status || null,
      priority: t.priority || null,
      channel: t.channel || null,
      subject: t.subject || null,
      first_message_text: firstMessage,
      user_id: t.user_id || null,
      user_name: userInfo.user_name,
      user_email: userInfo.user_email,
      company_name: userInfo.company_name,
      staff_id: t.staff_id || null,
      group_id: t.group_id || null,
      labels: t.labels?.length > 0 ? t.labels : null,
      closing_speed: t.closing_speed && t.closing_speed !== '-' ? parseInt(t.closing_speed) : null,
    });
  }

  // Upsert to Supabase
  const { error } = await supabase
    .from('support_tickets')
    .upsert(records, { onConflict: 'ticket_id' });

  if (error) {
    log(`ERROR: ${error.message}`);
    process.exit(1);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`SUCCESS: ${records.length} tickets upserted in ${duration}s`);
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
