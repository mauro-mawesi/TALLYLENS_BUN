-- Migration: Create budget_alerts table
-- Description: Historical record of all budget alerts sent to users

CREATE TABLE budget_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('threshold', 'predictive', 'comparative', 'digest', 'exceeded')),
    threshold INTEGER, -- percentage threshold (50, 75, 90, 100)
    current_spending DECIMAL(10,2) NOT NULL,
    budget_amount DECIMAL(10,2) NOT NULL,
    percentage DECIMAL(5,2) NOT NULL, -- calculated percentage of budget spent
    message TEXT NOT NULL,
    sent_via TEXT[] NOT NULL DEFAULT ARRAY['inApp'], -- ['push', 'email', 'inApp']
    sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    was_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMP,
    metadata JSONB, -- additional context like predictions, suggestions
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add comments
COMMENT ON TABLE budget_alerts IS 'Historical record of budget alerts sent to users';
COMMENT ON COLUMN budget_alerts.alert_type IS 'Type of alert: threshold, predictive, comparative, digest, exceeded';
COMMENT ON COLUMN budget_alerts.threshold IS 'Percentage threshold that triggered the alert (e.g., 50, 75, 90, 100)';
COMMENT ON COLUMN budget_alerts.current_spending IS 'User spending at the time alert was sent';
COMMENT ON COLUMN budget_alerts.budget_amount IS 'Budget amount at the time alert was sent';
COMMENT ON COLUMN budget_alerts.percentage IS 'Calculated percentage of budget spent (current_spending / budget_amount * 100)';
COMMENT ON COLUMN budget_alerts.sent_via IS 'Channels through which alert was sent: push, email, inApp';
COMMENT ON COLUMN budget_alerts.was_read IS 'Whether user has acknowledged/read the alert';
COMMENT ON COLUMN budget_alerts.metadata IS 'Additional context: predictions, insights, recommendations';

-- Create indexes for performance
CREATE INDEX idx_budget_alerts_budget_id ON budget_alerts(budget_id);
CREATE INDEX idx_budget_alerts_user_id ON budget_alerts(user_id);
CREATE INDEX idx_budget_alerts_alert_type ON budget_alerts(alert_type);
CREATE INDEX idx_budget_alerts_was_read ON budget_alerts(was_read);
CREATE INDEX idx_budget_alerts_sent_at ON budget_alerts(sent_at DESC);

-- Composite indexes for common queries
CREATE INDEX idx_budget_alerts_user_unread ON budget_alerts(user_id, was_read, sent_at DESC);
CREATE INDEX idx_budget_alerts_budget_type ON budget_alerts(budget_id, alert_type, sent_at DESC);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_budget_alerts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budget_alerts_updated_at
BEFORE UPDATE ON budget_alerts
FOR EACH ROW
EXECUTE FUNCTION update_budget_alerts_updated_at();

-- Trigger to set read_at timestamp when was_read changes to true
CREATE OR REPLACE FUNCTION set_budget_alert_read_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.was_read = true AND OLD.was_read = false THEN
        NEW.read_at = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budget_alerts_read_at
BEFORE UPDATE OF was_read ON budget_alerts
FOR EACH ROW
EXECUTE FUNCTION set_budget_alert_read_at();
