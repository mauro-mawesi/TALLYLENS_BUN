-- Migration: Create budgets table
-- Description: User-defined budgets with flexible periods and smart alerts

CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50), -- null = global budget, or 'grocery', 'food', 'transport', 'fuel', 'others'
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    period VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly', 'monthly', 'yearly', 'custom')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    alert_thresholds JSONB NOT NULL DEFAULT '[50, 75, 90, 100]',
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    allow_rollover BOOLEAN NOT NULL DEFAULT false,
    rollover_amount DECIMAL(10,2) DEFAULT 0,
    notification_channels JSONB NOT NULL DEFAULT '{"push": true, "email": false, "inApp": true}',
    metadata JSONB,
    last_alert_sent_at TIMESTAMP,
    last_alert_threshold INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add comments
COMMENT ON TABLE budgets IS 'User-defined budgets for expense tracking and alerts';
COMMENT ON COLUMN budgets.category IS 'Budget category: grocery, food, transport, fuel, others, or NULL for global budget';
COMMENT ON COLUMN budgets.period IS 'Budget period: weekly, monthly, yearly, or custom';
COMMENT ON COLUMN budgets.alert_thresholds IS 'Array of percentage thresholds (e.g., [50, 75, 90, 100])';
COMMENT ON COLUMN budgets.is_recurring IS 'Auto-create budget for next period when current expires';
COMMENT ON COLUMN budgets.allow_rollover IS 'Unused budget amount carries over to next period';
COMMENT ON COLUMN budgets.rollover_amount IS 'Amount rolled over from previous period';
COMMENT ON COLUMN budgets.notification_channels IS 'Notification channels: {push, email, inApp}';
COMMENT ON COLUMN budgets.metadata IS 'Additional configuration and custom settings';
COMMENT ON COLUMN budgets.last_alert_sent_at IS 'Timestamp of most recent alert';
COMMENT ON COLUMN budgets.last_alert_threshold IS 'Last threshold percentage that triggered alert';

-- Create indexes for performance
CREATE INDEX idx_budgets_user_id ON budgets(user_id);
CREATE INDEX idx_budgets_category ON budgets(category);
CREATE INDEX idx_budgets_is_active ON budgets(is_active);
CREATE INDEX idx_budgets_period ON budgets(period);
CREATE INDEX idx_budgets_is_recurring ON budgets(is_recurring);
CREATE INDEX idx_budgets_dates ON budgets(start_date, end_date);

-- Composite indexes for common queries
CREATE INDEX idx_budgets_user_category_active ON budgets(user_id, category, is_active);
CREATE INDEX idx_budgets_user_period ON budgets(user_id, start_date, end_date);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_budgets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budgets_updated_at
BEFORE UPDATE ON budgets
FOR EACH ROW
EXECUTE FUNCTION update_budgets_updated_at();

-- Constraint: end_date must be after start_date
ALTER TABLE budgets
ADD CONSTRAINT check_budget_dates CHECK (end_date > start_date);
