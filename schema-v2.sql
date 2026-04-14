-- ============================================
-- SUPPORT TICKETS DATABASE SCHEMA v2
-- С информацией о клиентах
-- ============================================

-- Удаляем старую таблицу (если нужно начать заново)
DROP TABLE IF EXISTS support_tickets CASCADE;

-- Основная таблица тикетов
CREATE TABLE support_tickets (
    -- Идентификаторы
    id BIGSERIAL PRIMARY KEY,
    ticket_id BIGINT UNIQUE NOT NULL,          -- OmniDesk case_id
    case_number TEXT,                           -- Номер тикета (912-437371)

    -- Даты
    created_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,

    -- Статус и приоритет
    status TEXT,                                -- open, waiting, closed
    priority TEXT,                              -- low, normal, high, critical
    channel TEXT,                               -- email, chat, phone, api

    -- Содержимое
    subject TEXT,
    first_message_text TEXT,

    -- Информация о клиенте
    user_id BIGINT,                             -- OmniDesk user_id
    user_name TEXT,                             -- Имя клиента
    user_email TEXT,                            -- Email клиента
    company_name TEXT,                          -- Название компании

    -- Информация о сотруднике
    staff_id BIGINT,                            -- ID ответственного сотрудника
    group_id BIGINT,                            -- ID группы

    -- Метаданные
    labels TEXT[],                              -- Массив меток
    custom_fields JSONB,                        -- Кастомные поля
    closing_speed INTEGER,                      -- Скорость закрытия (секунды)

    -- Служебные поля
    ingested_at TIMESTAMPTZ DEFAULT NOW(),      -- Когда загружено
    updated_in_db_at TIMESTAMPTZ DEFAULT NOW()  -- Когда обновлено в БД
);

-- Индексы для быстрого поиска
CREATE INDEX idx_tickets_created_at ON support_tickets(created_at DESC);
CREATE INDEX idx_tickets_status ON support_tickets(status);
CREATE INDEX idx_tickets_user_id ON support_tickets(user_id);
CREATE INDEX idx_tickets_company ON support_tickets(company_name) WHERE company_name IS NOT NULL;
CREATE INDEX idx_tickets_channel ON support_tickets(channel);
CREATE INDEX idx_tickets_priority ON support_tickets(priority);

-- Триггер для автообновления updated_in_db_at
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_in_db_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_timestamp
    BEFORE UPDATE ON support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- Включаем RLS (Row Level Security)
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Политика: service role имеет полный доступ
CREATE POLICY "Service role full access" ON support_tickets
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ============================================
-- ПОЛЕЗНЫЕ VIEW ДЛЯ АНАЛИТИКИ
-- ============================================

-- View: Тикеты за последнюю неделю
CREATE OR REPLACE VIEW tickets_last_week AS
SELECT *
FROM support_tickets
WHERE created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- View: Статистика по клиентам
CREATE OR REPLACE VIEW client_stats AS
SELECT
    COALESCE(company_name, user_name, user_email, 'Unknown') AS client,
    user_id,
    COUNT(*) AS ticket_count,
    COUNT(*) FILTER (WHERE status = 'closed') AS closed_count,
    COUNT(*) FILTER (WHERE status != 'closed') AS open_count,
    AVG(closing_speed) FILTER (WHERE closing_speed > 0) AS avg_closing_speed_sec,
    MIN(created_at) AS first_ticket,
    MAX(created_at) AS last_ticket
FROM support_tickets
GROUP BY COALESCE(company_name, user_name, user_email, 'Unknown'), user_id
ORDER BY ticket_count DESC;

-- View: Статистика по каналам
CREATE OR REPLACE VIEW channel_stats AS
SELECT
    channel,
    COUNT(*) AS ticket_count,
    COUNT(*) FILTER (WHERE status = 'closed') AS closed_count,
    ROUND(AVG(closing_speed) FILTER (WHERE closing_speed > 0)) AS avg_closing_speed_sec
FROM support_tickets
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY channel
ORDER BY ticket_count DESC;

-- ============================================
-- КОММЕНТАРИИ
-- ============================================
COMMENT ON TABLE support_tickets IS 'Тикеты поддержки из OmniDesk';
COMMENT ON COLUMN support_tickets.ticket_id IS 'ID тикета в OmniDesk (case_id)';
COMMENT ON COLUMN support_tickets.closing_speed IS 'Время до закрытия в секундах';
COMMENT ON COLUMN support_tickets.user_id IS 'ID клиента в OmniDesk';
