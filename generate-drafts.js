/**
 * ============================================
 * GENERATE AI DRAFTS FOR TODAY'S TICKETS
 * ============================================
 *
 * Fetches today's open tickets from Supabase and generates
 * AI draft responses using the Support AI Agent.
 *
 * Usage:
 *   node generate-drafts.js              # Today's open tickets
 *   node generate-drafts.js --all        # All today's tickets
 *   node generate-drafts.js --limit 5    # Limit to N tickets
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AGENT_URL = process.env.AGENT_URL || 'http://localhost:8000';

// Parse arguments
const args = process.argv.slice(2);
const INCLUDE_CLOSED = args.includes('--all');
const LIMIT_INDEX = args.indexOf('--limit');
const LIMIT = LIMIT_INDEX !== -1 ? parseInt(args[LIMIT_INDEX + 1]) : 20;
const DAYS_INDEX = args.indexOf('--days');
const DAYS = DAYS_INDEX !== -1 ? parseInt(args[DAYS_INDEX + 1]) : 0; // 0 = today only

// Initialize Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Get tickets from Supabase
 */
async function getTickets() {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - DAYS);
    startDate.setHours(0, 0, 0, 0);

    let query = supabase
        .from('support_tickets')
        .select('ticket_id, subject, first_message_text, user_name, company_name, status, channel, created_at')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(LIMIT);

    if (!INCLUDE_CLOSED) {
        query = query.neq('status', 'closed');
    }

    const { data, error } = await query;

    if (error) {
        throw new Error(`Supabase error: ${error.message}`);
    }

    return data || [];
}

/**
 * Generate draft response using AI Agent
 */
async function generateDraft(ticket) {
    const response = await fetch(`${AGENT_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ticket_id: String(ticket.ticket_id),
            question: ticket.first_message_text || '',
            subject: ticket.subject || '',
            client_name: ticket.company_name || ticket.user_name || 'Unknown',
            channel: ticket.channel || 'api'
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * Format output for console
 */
function formatResult(ticket, result, index, total) {
    const separator = '═'.repeat(70);
    const divider = '─'.repeat(70);

    const status = result.needs_escalation ? '⚠️  NEEDS REVIEW' : '✅ READY';
    const confidence = Math.round(result.confidence * 100);
    const categories = result.categories.join(', ');

    return `
${separator}
TICKET ${index + 1}/${total} | #${ticket.ticket_id} | ${status}
${separator}

📋 SUBJECT: ${ticket.subject || '(no subject)'}
👤 CLIENT: ${ticket.company_name || ticket.user_name || 'Unknown'}
📊 STATUS: ${ticket.status} | CHANNEL: ${ticket.channel}
🏷️  CATEGORIES: ${categories}
🎯 CONFIDENCE: ${confidence}% | 📚 DOCS: ${result.retrieved_docs_count}

${divider}
❓ QUESTION:
${divider}
${(ticket.first_message_text || '').substring(0, 500)}${(ticket.first_message_text || '').length > 500 ? '...' : ''}

${divider}
✍️  DRAFT RESPONSE:
${divider}
${result.draft_response}
`;
}

/**
 * Main function
 */
async function main() {
    console.log('\n🤖 MetaShip Support AI - Draft Generator\n');
    console.log(`📅 Date: ${new Date().toLocaleDateString('ru-RU')}`);
    console.log(`🔧 Agent: ${AGENT_URL}`);
    console.log(`📊 Mode: ${INCLUDE_CLOSED ? 'All tickets' : 'Open tickets only'}`);
    console.log(`📆 Period: ${DAYS === 0 ? 'Today' : `Last ${DAYS} days`}`);
    console.log(`📏 Limit: ${LIMIT} tickets\n`);

    // Check agent health
    try {
        const health = await fetch(`${AGENT_URL}/health`);
        if (!health.ok) throw new Error('Agent not healthy');
        console.log('✅ Agent is online\n');
    } catch (e) {
        console.error('❌ Agent is offline! Start it with: cd agent && uvicorn main:app --reload\n');
        process.exit(1);
    }

    // Fetch tickets
    console.log('📥 Fetching tickets...\n');
    const tickets = await getTickets();

    if (tickets.length === 0) {
        console.log('📭 No tickets found for today.\n');
        return;
    }

    console.log(`📬 Found ${tickets.length} ticket(s)\n`);

    // Generate drafts
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];

        process.stdout.write(`⏳ Processing ticket ${i + 1}/${tickets.length} (#${ticket.ticket_id})... `);

        try {
            const result = await generateDraft(ticket);
            results.push({ ticket, result, error: null });
            successCount++;
            console.log('✅');
        } catch (error) {
            results.push({ ticket, result: null, error: error.message });
            errorCount++;
            console.log(`❌ ${error.message}`);
        }

        // Small delay between requests
        if (i < tickets.length - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // Output results
    console.log('\n\n' + '═'.repeat(70));
    console.log('                         GENERATED DRAFTS');
    console.log('═'.repeat(70));

    for (let i = 0; i < results.length; i++) {
        const { ticket, result, error } = results[i];

        if (result) {
            console.log(formatResult(ticket, result, i, results.length));
        } else {
            console.log(`\n❌ TICKET #${ticket.ticket_id}: ERROR - ${error}\n`);
        }
    }

    // Summary
    console.log('\n' + '═'.repeat(70));
    console.log('                           SUMMARY');
    console.log('═'.repeat(70));
    console.log(`\n📊 Total: ${tickets.length} | ✅ Success: ${successCount} | ❌ Errors: ${errorCount}`);

    const needsReview = results.filter(r => r.result?.needs_escalation).length;
    const ready = results.filter(r => r.result && !r.result.needs_escalation).length;

    console.log(`📝 Ready to send: ${ready} | ⚠️  Needs review: ${needsReview}\n`);
}

main().catch(console.error);
