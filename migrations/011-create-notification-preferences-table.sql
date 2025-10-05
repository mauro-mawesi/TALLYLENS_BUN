-- Migration: Create notification_preferences table
-- Description: User notification settings and FCM token management

CREATE TABLE notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    budget_alerts BOOLEAN NOT NULL DEFAULT true,
    receipt_processing BOOLEAN NOT NULL DEFAULT true,
    weekly_digest BOOLEAN NOT NULL DEFAULT true,
    monthly_digest BOOLEAN NOT NULL DEFAULT true,
    price_alerts BOOLEAN NOT NULL DEFAULT true,
    product_recommendations BOOLEAN NOT NULL DEFAULT false,
    digest_frequency VARCHAR(20) NOT NULL DEFAULT 'weekly' CHECK (digest_frequency IN ('daily', 'weekly', 'monthly', 'none')),
    digest_day INTEGER CHECK (digest_day BETWEEN 0 AND 6), -- 0=Sunday, 6=Saturday
    digest_hour INTEGER DEFAULT 18 CHECK (digest_hour BETWEEN 0 AND 23),
    channels JSONB NOT NULL DEFAULT '{"push": true, "email": false, "inApp": true}',
    fcm_token VARCHAR(500), -- Firebase Cloud Messaging token
    fcm_token_updated_at TIMESTAMP,
    device_info JSONB, -- device metadata: platform, model, os_version
    timezone VARCHAR(50) DEFAULT 'UTC',
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
    quiet_hours_start INTEGER CHECK (quiet_hours_start BETWEEN 0 AND 23),
    quiet_hours_end INTEGER CHECK (quiet_hours_end BETWEEN 0 AND 23),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add comments
COMMENT ON TABLE notification_preferences IS 'User notification settings and FCM token management';
COMMENT ON COLUMN notification_preferences.budget_alerts IS 'Receive budget threshold and predictive alerts';
COMMENT ON COLUMN notification_preferences.receipt_processing IS 'Receive notifications when receipt processing completes';
COMMENT ON COLUMN notification_preferences.weekly_digest IS 'Receive weekly spending summary';
COMMENT ON COLUMN notification_preferences.monthly_digest IS 'Receive monthly spending report';
COMMENT ON COLUMN notification_preferences.price_alerts IS 'Receive product price change alerts';
COMMENT ON COLUMN notification_preferences.product_recommendations IS 'Receive AI product recommendations';
COMMENT ON COLUMN notification_preferences.digest_frequency IS 'Frequency for digest emails: daily, weekly, monthly, none';
COMMENT ON COLUMN notification_preferences.digest_day IS 'Day of week for digest (0=Sunday, 6=Saturday)';
COMMENT ON COLUMN notification_preferences.digest_hour IS 'Hour of day for digest (0-23)';
COMMENT ON COLUMN notification_preferences.channels IS 'Preferred notification channels: {push, email, inApp}';
COMMENT ON COLUMN notification_preferences.fcm_token IS 'Firebase Cloud Messaging token for push notifications';
COMMENT ON COLUMN notification_preferences.device_info IS 'Device metadata: {platform, model, os_version, app_version}';
COMMENT ON COLUMN notification_preferences.quiet_hours_enabled IS 'Enable do-not-disturb during specified hours';
COMMENT ON COLUMN notification_preferences.quiet_hours_start IS 'Start hour for quiet period (0-23)';
COMMENT ON COLUMN notification_preferences.quiet_hours_end IS 'End hour for quiet period (0-23)';

-- Create indexes for performance
CREATE INDEX idx_notification_preferences_user_id ON notification_preferences(user_id);
CREATE INDEX idx_notification_preferences_fcm_token ON notification_preferences(fcm_token) WHERE fcm_token IS NOT NULL;
CREATE INDEX idx_notification_preferences_digest_frequency ON notification_preferences(digest_frequency);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_notification_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notification_preferences_updated_at
BEFORE UPDATE ON notification_preferences
FOR EACH ROW
EXECUTE FUNCTION update_notification_preferences_updated_at();

-- Trigger to set fcm_token_updated_at when FCM token changes
CREATE OR REPLACE FUNCTION set_fcm_token_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.fcm_token IS DISTINCT FROM OLD.fcm_token THEN
        NEW.fcm_token_updated_at = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notification_preferences_fcm_token_updated
BEFORE UPDATE OF fcm_token ON notification_preferences
FOR EACH ROW
EXECUTE FUNCTION set_fcm_token_updated_at();

-- Create default preferences for existing users
INSERT INTO notification_preferences (user_id)
SELECT id FROM users
WHERE NOT EXISTS (
    SELECT 1 FROM notification_preferences WHERE notification_preferences.user_id = users.id
);
