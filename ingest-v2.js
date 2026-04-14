/**
 * OMNIDESK TICKET INGESTION v2
 * С информацией о клиентах
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

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
  daysToFetch: 7,
};

// Auth header
function getAuthHeader() {
  const credentials = `${CONFIG.omnidesk.email}:${CONFIG.omnidesk.apiToken}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

// Sleep helper
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// API request with retry
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
    console.log(`  Rate limited, waiting...`);
    await sleep((4 - retries) * 2000);
    return apiRequest(endpoint, retries - 1);
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

// Fetch all tickets from last N days
async function fetchTickets() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CONFIG.daysToFetch);

  console.log(`Fetching tickets since ${cutoffDate.toISOString()}`);

  const tickets = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 50) {
    console.log(`  Page ${page}...`);

    const response = await apiRequest(`/cases.json?limit=100&page=${page}&sort=created_at&order=desc`);

    const keys = Object.keys(response).filter(k => !isNaN(parseInt(k)));
    if (keys.length === 0) {
      hasMore = false;
      break;
    }

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

    if (olderCount === keys.length) {
      hasMore = false;
    } else if (keys.length < 100) {
      hasMore = false;
    } else {
      page++;
      await sleep(CONFIG.omnidesk.rateLimitDelay);
    }
  }

  console.log(`Found ${tickets.length} tickets`);
  return tickets;
}

// Fetch user details
async function fetchUser(userId) {
  try {
    const response = await apiRequest(`/users/${userId}.json`);
    const user = response.user || response;
    return {
      user_name: user.user_full_name || null,
      user_email: user.user_email || user.user_screen_name || null,
      company_name: user.company_name || null,
    };
  } catch (e) {
    console.log(`  Warning: Could not fetch user ${userId}`);
    return { user_name: null, user_email: null, company_name: null };
  }
}

// Fetch first message
async function fetchFirstMessage(ticketId) {
  try {
    const response = await apiRequest(`/cases/${ticketId}/messages.json`);
    const keys = Object.keys(response).filter(k => !isNaN(parseInt(k)));

    if (keys.length === 0) return null;

    const messages = keys.map(k => response[k].message || response[k]);
    messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Prefer customer message (no staff_id)
    const customerMsg = messages.find(m => !m.staff_id && !m.note);
    const msg = customerMsg || messages[0];

    let text = msg.content || msg.content_html || null;
    if (text) {
      text = text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 5000);
    }
    return text;
  } catch (e) {
    return null;
  }
}

// Parse date
function parseDate(dateStr) {
  if (!dateStr || dateStr === '-') return null;
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return null;
  }
}

// Main
async function main() {
  console.log('='.repeat(50));
  console.log('OMNIDESK INGESTION v2');
  console.log('='.repeat(50));

  // Initialize Supabase
  const supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.key);

  // Step 1: Fetch tickets
  const tickets = await fetchTickets();
  if (tickets.length === 0) {
    console.log('No tickets found.');
    return;
  }

  // Step 2: Process each ticket
  console.log('\nProcessing tickets...');
  const records = [];
  const userCache = new Map();

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    const ticketId = t.case_id || t.id;

    if ((i + 1) % 10 === 0 || i === 0) {
      console.log(`  ${i + 1}/${tickets.length} - ticket ${ticketId}`);
    }

    // Fetch user (with cache)
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

    // Fetch first message
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

  // Step 3: Upsert to Supabase
  console.log(`\nUpserting ${records.length} tickets to Supabase...`);

  // Batch upsert (50 at a time)
  const batchSize = 50;
  let inserted = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const { error } = await supabase
      .from('support_tickets')
      .upsert(batch, { onConflict: 'ticket_id' });

    if (error) {
      console.error(`Error upserting batch: ${error.message}`);
    } else {
      inserted += batch.length;
      console.log(`  Batch ${Math.floor(i/batchSize) + 1}: ${batch.length} tickets`);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('DONE');
  console.log('='.repeat(50));
  console.log(`Total processed: ${records.length}`);
  console.log(`Users cached: ${userCache.size}`);
}

main().catch(console.error);
