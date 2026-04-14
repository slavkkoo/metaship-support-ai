-- ============================================
-- SUPPORT TICKETS RAW TABLE SCHEMA
-- Stage 1: Data Ingestion for SLA Analytics
-- ============================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Main table for raw ticket data
CREATE TABLE IF NOT EXISTS support_tickets_raw (
    -- Primary key: auto-generated UUID
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Omnidesk ticket identifier (unique, prevents duplicates)
    ticket_id TEXT UNIQUE NOT NULL,

    -- Ticket timestamps from Omnidesk
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ,

    -- Ticket status (e.g., 'open', 'closed', 'pending')
    status TEXT,

    -- Ticket priority (may be null if not set)
    priority TEXT,

    -- Ticket subject/topic
    subject TEXT,

    -- First message text from the ticket (customer or support)
    first_message_text TEXT,

    -- Timestamp when this record was ingested into our system
    ingested_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries by ticket_id (already unique, but explicit)
CREATE INDEX IF NOT EXISTS idx_support_tickets_raw_ticket_id
    ON support_tickets_raw(ticket_id);

-- Index for date-based queries (useful for SLA analytics later)
CREATE INDEX IF NOT EXISTS idx_support_tickets_raw_created_at
    ON support_tickets_raw(created_at DESC);

-- Index for status-based queries
CREATE INDEX IF NOT EXISTS idx_support_tickets_raw_status
    ON support_tickets_raw(status);

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE support_tickets_raw IS 'Raw support ticket data ingested from Omnidesk API';
COMMENT ON COLUMN support_tickets_raw.ticket_id IS 'Unique ticket ID from Omnidesk (case_id)';
COMMENT ON COLUMN support_tickets_raw.first_message_text IS 'Text of the first message in the ticket thread';
COMMENT ON COLUMN support_tickets_raw.ingested_at IS 'Timestamp when this record was inserted into Supabase';
