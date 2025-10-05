-- Migration: Add search history and saved filters tables
-- Description: Stores user search queries and saved filter combinations

-- Create search_history table
CREATE TABLE search_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    results_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index on user_id and created_at for fast retrieval
CREATE INDEX search_history_user_created_idx ON search_history(user_id, created_at DESC);

-- Create index on user_id and query for duplicate prevention
CREATE INDEX search_history_user_query_idx ON search_history(user_id, query);

-- Create saved_filters table for favorite filter combinations
CREATE TABLE saved_filters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    filters JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    use_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT saved_filters_user_name_unique UNIQUE(user_id, name)
);

-- Create index on user_id for fast retrieval
CREATE INDEX saved_filters_user_idx ON saved_filters(user_id, is_active);

-- Add comments
COMMENT ON TABLE search_history IS 'Stores user search query history for suggestions';
COMMENT ON TABLE saved_filters IS 'Stores user favorite filter combinations for quick access';
COMMENT ON COLUMN saved_filters.filters IS 'JSON object containing filter parameters: {category, dateFrom, dateTo, minAmount, maxAmount, etc}';
