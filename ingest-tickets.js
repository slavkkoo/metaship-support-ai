/**
 * ============================================
 * OMNIDESK TICKET INGESTION SCRIPT
 * Stage 1: Data Ingestion for SLA Analytics
 * ============================================
 *
 * This script fetches support tickets from Omnidesk API
 * and stores them in Supabase for later analytics.
 *
 * Run with: npm run ingest
 * Dry run:  npm run ingest -- --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables
config();

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  // Omnidesk API settings
  omnidesk: {
    subdomain: process.env.OMNIDESK_SUBDOMAIN || 'pimpay', // Your Omnidesk subdomain
    email: process.env.OMNIDESK_EMAIL,
    apiToken: process.env.OMNIDESK_API_TOKEN,
    // Rate limit: 500 requests/min (Standard plan) = 120ms min delay
    rateLimitDelay: 150, // ms between requests (~400 req/min with margin)
  },

  // Supabase settings
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY, // Use service role for inserts
  },

  // Ingestion settings
  ingestion: {
    daysToFetch: 7, // Fetch tickets from last N days
    pageSize: 100, // Tickets per API page
    maxPages: 50, // Safety limit to prevent infinite loops
  },
};

// Check for dry run mode
const DRY_RUN = process.argv.includes('--dry-run');
// Check for user enrichment mode (fetches user details - slower but gets names/emails)
const ENRICH_USERS = process.argv.includes('--enrich-users');

// ============================================
// OMNIDESK API CLIENT
// ============================================

/**
 * Build Omnidesk API base URL
 */
function getOmnideskBaseUrl() {
  return `https://${CONFIG.omnidesk.subdomain}.omnidesk.ru/api`;
}

/**
 * Build Basic Auth header for Omnidesk API
 * Omnidesk uses email:api_token format
 */
function getAuthHeader() {
  const credentials = `${CONFIG.omnidesk.email}:${CONFIG.omnidesk.apiToken}`;
  const encoded = Buffer.from(credentials).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Sleep helper for rate limiting
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Make authenticated request to Omnidesk API with retry on 429
 * @param {string} endpoint - API endpoint (e.g., '/cases.json')
 * @param {object} params - Query parameters
 * @param {number} retries - Number of retries left
 */
async function omnideskRequest(endpoint, params = {}, retries = 3) {
  const url = new URL(`${getOmnideskBaseUrl()}${endpoint}`);

  // Add query parameters
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
    },
  });

  // Handle rate limiting with exponential backoff
  if (response.status === 429 && retries > 0) {
    const waitTime = (4 - retries) * 2000; // 2s, 4s, 6s
    console.log(`    Rate limited. Waiting ${waitTime/1000}s before retry...`);
    await sleep(waitTime);
    return omnideskRequest(endpoint, params, retries - 1);
  }

  if (!response.ok) {
    throw new Error(`Omnidesk API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// ============================================
// PAGINATION LOGIC
// ============================================

/**
 * Fetch all tickets from the last N days with pagination
 *
 * PAGINATION EXPLANATION:
 * - Omnidesk API returns paginated results
 * - We iterate through pages until:
 *   a) No more tickets are returned
 *   b) All returned tickets are older than our date threshold
 *   c) We hit the safety limit (maxPages)
 * - Tickets are filtered by created_at >= (now - daysToFetch)
 *
 * @returns {Array} Array of ticket objects
 */
async function fetchTicketsWithPagination() {
  const tickets = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CONFIG.ingestion.daysToFetch);

  console.log(`Fetching tickets from ${cutoffDate.toISOString()} to now...`);
  console.log(`Cutoff date: ${cutoffDate.toISOString()}`);

  let page = 1;
  let hasMorePages = true;

  while (hasMorePages && page <= CONFIG.ingestion.maxPages) {
    console.log(`  Fetching page ${page}...`);

    try {
      // Omnidesk API: /cases.json returns cases list
      // Parameters: page, limit, sort (created_at desc to get newest first)
      const response = await omnideskRequest('/cases.json', {
        page: page,
        limit: CONFIG.ingestion.pageSize,
        sort: 'created_at',
        order: 'desc', // Newest first for efficient date filtering
      });

      // Omnidesk returns object with numeric keys: {"0": {"case": ...}, "1": {"case": ...}}
      // Convert to array
      let cases = [];
      if (response.cases && Array.isArray(response.cases)) {
        cases = response.cases;
      } else if (Array.isArray(response)) {
        cases = response;
      } else if (typeof response === 'object' && response !== null) {
        // Handle numeric key object format: {"0": {...}, "1": {...}}
        const keys = Object.keys(response).filter(k => !isNaN(parseInt(k)));
        cases = keys.map(k => response[k]);
      }

      if (cases.length === 0) {
        console.log(`  Page ${page}: No more tickets`);
        hasMorePages = false;
        break;
      }

      console.log(`  Page ${page}: Received ${cases.length} tickets`);

      // Filter tickets by date and collect valid ones
      let ticketsBeforeCutoff = 0;

      for (const caseData of cases) {
        // Handle nested case object (Omnidesk may wrap in { case: {...} })
        const ticket = caseData.case || caseData;

        const createdAt = new Date(ticket.created_at);

        if (createdAt >= cutoffDate) {
          tickets.push(ticket);
        } else {
          ticketsBeforeCutoff++;
        }
      }

      // If all tickets on this page are older than cutoff, stop pagination
      // (since we're sorting by created_at desc)
      if (ticketsBeforeCutoff === cases.length) {
        console.log(`  All tickets on page ${page} are older than cutoff. Stopping.`);
        hasMorePages = false;
        break;
      }

      // If we got fewer tickets than page size, this is the last page
      if (cases.length < CONFIG.ingestion.pageSize) {
        hasMorePages = false;
      }

      page++;

      // Rate limiting: wait between requests
      if (hasMorePages) {
        await sleep(CONFIG.omnidesk.rateLimitDelay);
      }
    } catch (error) {
      console.error(`  Error fetching page ${page}:`, error.message);
      throw error;
    }
  }

  console.log(`Total tickets fetched: ${tickets.length}`);
  return tickets;
}

// ============================================
// FIRST MESSAGE EXTRACTION
// ============================================

/**
 * Fetch the first message for a ticket
 *
 * FIRST MESSAGE SELECTION LOGIC:
 * - Omnidesk may provide messages in ticket object (messages array)
 * - OR require a separate API call to /cases/{id}/messages.json
 * - We select the message with the EARLIEST created_at timestamp
 * - This represents the initial customer request
 *
 * @param {object} ticket - Ticket object from API
 * @returns {string|null} First message text or null
 */
async function getFirstMessageText(ticket) {
  // Case 1: Messages are embedded in ticket object
  if (ticket.messages && Array.isArray(ticket.messages) && ticket.messages.length > 0) {
    // Sort by created_at ascending to get the earliest message
    const sortedMessages = [...ticket.messages].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );
    return extractMessageText(sortedMessages[0]);
  }

  // Case 2: First message is in content/content_text field
  if (ticket.content || ticket.content_text || ticket.description) {
    return ticket.content || ticket.content_text || ticket.description;
  }

  // Case 3: Need to fetch messages via separate API call
  const ticketId = ticket.case_id || ticket.id;

  try {
    const response = await omnideskRequest(`/cases/${ticketId}/messages.json`);

    // Handle response format: {"0": {"message": {...}}, "1": {...}, "total_count": N}
    let messages = [];
    if (response.messages && Array.isArray(response.messages)) {
      messages = response.messages;
    } else if (Array.isArray(response)) {
      messages = response;
    } else if (typeof response === 'object' && response !== null) {
      // Convert numeric key object to array
      const keys = Object.keys(response).filter(k => !isNaN(parseInt(k)));
      messages = keys.map(k => response[k]);
    }

    if (messages.length === 0) {
      return null;
    }

    // Sort by created_at ascending and get first message
    const sortedMessages = [...messages].sort((a, b) => {
      const msgA = a.message || a;
      const msgB = b.message || b;
      return new Date(msgA.created_at) - new Date(msgB.created_at);
    });

    return extractMessageText(sortedMessages[0]);
  } catch (error) {
    console.warn(`  Warning: Could not fetch messages for ticket ${ticketId}: ${error.message}`);
    return null;
  }
}

/**
 * Extract text content from a message object
 * @param {object} message - Message object (may be wrapped)
 */
function extractMessageText(message) {
  const msg = message.message || message;

  // Try common field names for message content
  return (
    msg.content ||
    msg.content_text ||
    msg.text ||
    msg.body ||
    msg.html_body?.replace(/<[^>]*>/g, ' ').trim() || // Strip HTML if needed
    null
  );
}

// ============================================
// USER DATA ENRICHMENT
// ============================================

/**
 * Fetch user details from Omnidesk
 * @param {number} userId - User ID
 * @returns {object|null} User data or null if failed
 */
async function fetchUserData(userId) {
  if (!userId) return null;

  try {
    const response = await omnideskRequest(`/users/${userId}.json`);
    return response.user || response;
  } catch (error) {
    // Silently fail - user data is optional
    return null;
  }
}

/**
 * Fetch user data for multiple users (with caching to avoid duplicate requests)
 * @param {Array} tickets - Array of tickets
 * @returns {Map} Map of userId -> userData
 */
async function fetchUsersData(tickets) {
  const userCache = new Map();

  // Get unique user IDs
  const userIds = [...new Set(tickets.map(t => t.user_id).filter(Boolean))];

  console.log(`  Fetching data for ${userIds.length} unique users...`);

  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i];

    if ((i + 1) % 20 === 0 || i === 0) {
      console.log(`    Loading user ${i + 1}/${userIds.length}...`);
    }

    const userData = await fetchUserData(userId);
    if (userData) {
      userCache.set(userId, userData);
    }

    // Rate limiting
    if (i < userIds.length - 1) {
      await sleep(CONFIG.omnidesk.rateLimitDelay);
    }
  }

  console.log(`  Loaded ${userCache.size} user profiles.`);
  return userCache;
}

// ============================================
// DATA TRANSFORMATION
// ============================================

/**
 * Transform Omnidesk ticket to our database schema
 * @param {object} ticket - Raw ticket from Omnidesk
 * @param {string|null} firstMessageText - Extracted first message
 * @param {object|null} userData - Optional user data from /users/{id}.json
 */
function transformTicket(ticket, firstMessageText, userData = null) {
  // Parse closing_speed (может быть "-" или число)
  let closingSpeed = null;
  if (ticket.closing_speed && ticket.closing_speed !== '-') {
    closingSpeed = parseInt(ticket.closing_speed, 10) || null;
  }

  // Parse updated_at
  let updatedAt = null;
  if (ticket.updated_at && ticket.updated_at !== '-') {
    updatedAt = new Date(ticket.updated_at).toISOString();
  }

  return {
    ticket_id: parseInt(ticket.case_id || ticket.id, 10),
    case_number: ticket.case_number || null,
    created_at: new Date(ticket.created_at).toISOString(),
    closed_at: ticket.closed_at && ticket.closed_at !== '-' ? new Date(ticket.closed_at).toISOString() : null,
    updated_at: updatedAt,
    status: ticket.status || null,
    priority: ticket.priority || null,
    channel: ticket.channel || null,
    subject: ticket.subject || null,
    first_message_text: firstMessageText,

    // User info from ticket
    user_id: ticket.user_id ? parseInt(ticket.user_id, 10) : null,
    // User info from /users/{id}.json (if enriched)
    user_name: userData?.user_full_name || null,
    user_email: userData?.user_email || null,
    company_name: userData?.company_name || null,

    // Staff info
    staff_id: ticket.staff_id ? parseInt(ticket.staff_id, 10) : null,
    group_id: ticket.group_id ? parseInt(ticket.group_id, 10) : null,

    custom_fields: ticket.custom_fields || null,
    labels: ticket.labels && ticket.labels.length > 0 ? ticket.labels : null,
    closing_speed: closingSpeed,
    // ingested_at is set by database default
  };
}

// ============================================
// SUPABASE OPERATIONS
// ============================================

/**
 * Initialize Supabase client
 */
function getSupabaseClient() {
  if (!CONFIG.supabase.url || !CONFIG.supabase.key) {
    throw new Error('Missing Supabase configuration. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  return createClient(CONFIG.supabase.url, CONFIG.supabase.key);
}

/**
 * Insert tickets into Supabase with deduplication
 *
 * DEDUPLICATION LOGIC:
 * - Uses Supabase upsert with onConflict: 'ticket_id'
 * - If ticket_id already exists, the row is UPDATED (not duplicated)
 * - This ensures same ticket is never inserted twice
 * - Re-running the script safely updates existing records
 *
 * @param {object} supabase - Supabase client
 * @param {Array} tickets - Array of transformed ticket objects
 */
async function upsertTickets(supabase, tickets) {
  if (tickets.length === 0) {
    console.log('No tickets to insert.');
    return { inserted: 0, updated: 0 };
  }

  console.log(`Upserting ${tickets.length} tickets to Supabase...`);

  // Get existing ticket IDs to count inserts vs updates
  const ticketIds = tickets.map((t) => t.ticket_id);
  const { data: existingTickets } = await supabase
    .from('support_tickets')
    .select('ticket_id')
    .in('ticket_id', ticketIds);

  const existingIds = new Set((existingTickets || []).map((t) => t.ticket_id));
  const newCount = tickets.filter((t) => !existingIds.has(t.ticket_id)).length;
  const updateCount = tickets.length - newCount;

  // Perform upsert (insert or update on conflict)
  const { data, error } = await supabase
    .from('support_tickets')
    .upsert(tickets, {
      onConflict: 'ticket_id', // Unique constraint column
      ignoreDuplicates: false, // Update existing records
    })
    .select();

  if (error) {
    throw new Error(`Supabase upsert error: ${error.message}`);
  }

  return { inserted: newCount, updated: updateCount };
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main() {
  console.log('============================================');
  console.log('OMNIDESK TICKET INGESTION');
  console.log('============================================');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no database writes)' : 'LIVE'}`);
  console.log(`User enrichment: ${ENRICH_USERS ? 'ON (fetching user names/emails)' : 'OFF'}`);
  console.log(`Date range: Last ${CONFIG.ingestion.daysToFetch} days`);
  console.log('');

  // Validate configuration
  if (!CONFIG.omnidesk.email || !CONFIG.omnidesk.apiToken) {
    throw new Error('Missing Omnidesk credentials. Check OMNIDESK_EMAIL and OMNIDESK_API_TOKEN.');
  }

  try {
    // Step 1: Fetch tickets from Omnidesk
    console.log('Step 1: Fetching tickets from Omnidesk...');
    const tickets = await fetchTicketsWithPagination();

    if (tickets.length === 0) {
      console.log('No tickets found in the specified date range.');
      return;
    }

    // Step 2: Fetch user data (if enrichment is enabled)
    let userCache = new Map();
    if (ENRICH_USERS) {
      console.log('\nStep 2: Fetching user profiles...');
      userCache = await fetchUsersData(tickets);
    }

    // Step 3: Extract first message for each ticket and transform
    console.log(`\nStep ${ENRICH_USERS ? '3' : '2'}: Extracting first messages and transforming...`);
    const transformedTickets = [];

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const ticketId = ticket.case_id || ticket.id;

      if ((i + 1) % 10 === 0 || i === 0) {
        console.log(`  Processing ticket ${i + 1}/${tickets.length}...`);
      }

      // Get first message (may require API call)
      const firstMessageText = await getFirstMessageText(ticket);

      // Get user data from cache (if enrichment was enabled)
      const userData = userCache.get(ticket.user_id) || null;

      // Transform to our schema
      const transformed = transformTicket(ticket, firstMessageText, userData);
      transformedTickets.push(transformed);

      // Rate limiting for message fetches
      if (i < tickets.length - 1) {
        await sleep(CONFIG.omnidesk.rateLimitDelay);
      }
    }

    console.log(`\nTransformed ${transformedTickets.length} tickets.`);

    // Preview first ticket in dry run mode
    if (DRY_RUN) {
      console.log('\nSample transformed ticket:');
      console.log(JSON.stringify(transformedTickets[0], null, 2));
      console.log('\nDry run complete. No data written to database.');
      return;
    }

    // Step 4: Insert into Supabase
    console.log(`\nStep ${ENRICH_USERS ? '4' : '3'}: Inserting into Supabase...`);
    const supabase = getSupabaseClient();
    const result = await upsertTickets(supabase, transformedTickets);

    console.log('\n============================================');
    console.log('INGESTION COMPLETE');
    console.log('============================================');
    console.log(`New tickets inserted: ${result.inserted}`);
    console.log(`Existing tickets updated: ${result.updated}`);
    console.log(`Total processed: ${transformedTickets.length}`);
  } catch (error) {
    console.error('\n============================================');
    console.error('INGESTION FAILED');
    console.error('============================================');
    console.error(error.message);
    process.exit(1);
  }
}

// Run the script
main();
