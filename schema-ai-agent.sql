-- Schema for AI Support Agent logging
-- Run this in Supabase SQL Editor

-- Table for logging AI-generated responses
CREATE TABLE IF NOT EXISTS ai_responses_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id TEXT NOT NULL,
    question TEXT,
    draft_response TEXT,
    categories TEXT,
    needs_escalation BOOLEAN DEFAULT FALSE,

    -- Feedback from operator
    was_used BOOLEAN DEFAULT NULL,
    operator_edits TEXT DEFAULT NULL,
    feedback_score INTEGER CHECK (feedback_score >= 1 AND feedback_score <= 5),
    feedback_comment TEXT,

    -- Metadata
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,

    -- Index for fast lookups
    CONSTRAINT unique_ticket_response UNIQUE (ticket_id, generated_at)
);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_ai_responses_generated_at ON ai_responses_log(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_responses_needs_escalation ON ai_responses_log(needs_escalation);
CREATE INDEX IF NOT EXISTS idx_ai_responses_was_used ON ai_responses_log(was_used);

-- View for AI agent performance metrics
CREATE OR REPLACE VIEW ai_agent_metrics AS
SELECT
    DATE_TRUNC('day', generated_at) as day,
    COUNT(*) as total_responses,
    COUNT(*) FILTER (WHERE was_used = TRUE) as used_responses,
    COUNT(*) FILTER (WHERE was_used = FALSE) as rejected_responses,
    COUNT(*) FILTER (WHERE needs_escalation = TRUE) as escalations,
    ROUND(
        COUNT(*) FILTER (WHERE was_used = TRUE)::NUMERIC /
        NULLIF(COUNT(*) FILTER (WHERE was_used IS NOT NULL), 0) * 100,
        1
    ) as acceptance_rate,
    AVG(feedback_score) FILTER (WHERE feedback_score IS NOT NULL) as avg_feedback_score
FROM ai_responses_log
GROUP BY DATE_TRUNC('day', generated_at)
ORDER BY day DESC;

-- View for category performance
CREATE OR REPLACE VIEW ai_agent_category_metrics AS
SELECT
    categories,
    COUNT(*) as total_responses,
    COUNT(*) FILTER (WHERE was_used = TRUE) as used_count,
    ROUND(
        COUNT(*) FILTER (WHERE was_used = TRUE)::NUMERIC /
        NULLIF(COUNT(*) FILTER (WHERE was_used IS NOT NULL), 0) * 100,
        1
    ) as acceptance_rate,
    AVG(feedback_score) FILTER (WHERE feedback_score IS NOT NULL) as avg_score
FROM ai_responses_log
GROUP BY categories
ORDER BY total_responses DESC;

-- Function to update response feedback
CREATE OR REPLACE FUNCTION update_ai_response_feedback(
    p_ticket_id TEXT,
    p_was_used BOOLEAN,
    p_operator_edits TEXT DEFAULT NULL,
    p_feedback_score INTEGER DEFAULT NULL,
    p_feedback_comment TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    UPDATE ai_responses_log
    SET
        was_used = p_was_used,
        operator_edits = p_operator_edits,
        feedback_score = p_feedback_score,
        feedback_comment = p_feedback_comment,
        reviewed_at = NOW()
    WHERE ticket_id = p_ticket_id
    AND reviewed_at IS NULL
    ORDER BY generated_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Sample insert for testing
-- INSERT INTO ai_responses_log (ticket_id, question, draft_response, categories, needs_escalation)
-- VALUES ('test-123', 'Как создать заказ?', 'Для создания заказа используйте...', 'API: Создание заказа', false);
