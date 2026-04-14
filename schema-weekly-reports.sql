-- ============================================
-- WEEKLY REPORTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS weekly_reports (
    id BIGSERIAL PRIMARY KEY,

    -- Период отчёта
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    week_number INTEGER,
    year INTEGER,

    -- Ключевые метрики
    total_tickets INTEGER DEFAULT 0,
    closed_tickets INTEGER DEFAULT 0,
    open_tickets INTEGER DEFAULT 0,
    avg_closing_time_hours NUMERIC(10,2),

    -- Breakdown по каналам (JSON)
    channels_breakdown JSONB,

    -- Breakdown по приоритетам (JSON)
    priority_breakdown JSONB,

    -- ТОП клиентов (JSON array)
    top_clients JSONB,

    -- ТОП проблем/кластеров (JSON array)
    top_issues JSONB,

    -- AI-анализ
    executive_summary TEXT,
    risks JSONB,
    recommendations JSONB,

    -- Полный отчёт (JSON)
    full_report JSONB,

    -- Служебные поля
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Уникальность по неделе
    UNIQUE(week_start, week_end)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_weekly_reports_week ON weekly_reports(week_start DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_year_week ON weekly_reports(year, week_number);

COMMENT ON TABLE weekly_reports IS 'Еженедельные отчёты по тикетам поддержки';
