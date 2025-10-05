# Budgets & Smart Alerts Feature - Backend Documentation

## Overview

The Budgets & Smart Alerts feature transforms TallyLens from a simple receipt logger into a comprehensive financial control tool. Users can create budgets, receive intelligent alerts, and get AI-powered spending insights.

### Key Features

- **Flexible Budget Periods**: Weekly, monthly, yearly, or custom date ranges
- **Category & Global Budgets**: Set budgets per category (grocery, transport, etc.) or globally
- **Configurable Alert Thresholds**: Customize alert percentages (default: 50%, 75%, 90%, 100%)
- **Predictive Alerts**: ML-based predictions of budget exceedance
- **Recurring Budgets**: Auto-renewal with optional rollover support
- **Multi-Channel Notifications**: Push (FCM), email, and in-app notifications
- **Quiet Hours**: Do-not-disturb mode for specific time ranges
- **Digest Emails**: Weekly and monthly spending summaries
- **AI Insights**: Smart recommendations and spending analysis

## Database Schema

### Tables

#### `budgets`
- Stores user-defined budgets with flexible configuration
- Supports recurring budgets with rollover
- Configurable alert thresholds per budget

#### `budget_alerts`
- Historical record of all alerts sent to users
- Tracks read/unread status
- Prevents alert spam with smart deduplication

#### `notification_preferences`
- User notification settings
- FCM token management for push notifications
- Digest scheduling and quiet hours configuration

## API Endpoints

### Budgets

#### `GET /api/budgets`
List all budgets for authenticated user with optional filtering.

**Query Parameters:**
- `category` (optional): Filter by category
- `isActive` (optional): Filter by active status
- `period` (optional): Filter by period (weekly, monthly, yearly, custom)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Monthly Groceries",
      "category": "grocery",
      "amount": 500.00,
      "period": "monthly",
      "startDate": "2025-10-01",
      "endDate": "2025-10-31",
      "isActive": true,
      "isRecurring": true,
      "allowRollover": true,
      "alertThresholds": [50, 75, 90, 100],
      "notificationChannels": {
        "push": true,
        "email": false,
        "inApp": true
      }
    }
  ]
}
```

#### `POST /api/budgets`
Create a new budget.

**Request Body:**
```json
{
  "name": "Monthly Groceries",
  "category": "grocery",
  "amount": 500.00,
  "period": "monthly",
  "startDate": "2025-10-01",
  "endDate": "2025-10-31",
  "currency": "USD",
  "isRecurring": true,
  "allowRollover": true,
  "alertThresholds": [50, 75, 90, 100],
  "notificationChannels": {
    "push": true,
    "email": false,
    "inApp": true
  }
}
```

**Validation:**
- `name`: 1-255 characters
- `category`: One of: grocery, transport, food, fuel, others, or null (global)
- `amount`: Positive decimal
- `period`: weekly, monthly, yearly, or custom
- `startDate`: ISO 8601 date
- `endDate`: ISO 8601 date, must be after startDate
- `alertThresholds`: Array of positive integers (0-200)

#### `GET /api/budgets/:id`
Get specific budget details.

#### `PUT /api/budgets/:id`
Update existing budget.

#### `DELETE /api/budgets/:id`
Delete budget (soft delete if has historical data).

#### `POST /api/budgets/:id/duplicate`
Duplicate an existing budget with a new time period.

#### `GET /api/budgets/:id/progress`
Get current spending progress for a budget.

**Response:**
```json
{
  "success": true,
  "data": {
    "budgetId": "uuid",
    "budgetName": "Monthly Groceries",
    "totalBudget": 500.00,
    "currentSpending": 327.45,
    "remainingBudget": 172.55,
    "percentage": 65.49,
    "daysRemaining": 12,
    "daysElapsed": 18,
    "receiptCount": 23,
    "isActive": true,
    "status": "on_track"
  }
}
```

#### `GET /api/budgets/summary`
Get summary of all user budgets with progress.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalBudgets": 5,
    "activeBudgets": 3,
    "budgets": [...],
    "overallStats": {
      "totalBudgetAmount": 2000.00,
      "totalSpent": 1245.32,
      "totalRemaining": 754.68,
      "overallPercentage": 62.27
    }
  }
}
```

#### `GET /api/budgets/:id/insights`
Get AI-generated insights for a budget.

**Response:**
```json
{
  "success": true,
  "data": {
    "budgetId": "uuid",
    "insights": [
      {
        "type": "spending_pace",
        "severity": "warning",
        "message": "You're spending faster than usual. Consider reviewing your budget.",
        "data": {
          "currentPace": "fast",
          "projectedTotal": 650.00,
          "recommendation": "Reduce daily spending to $15.50"
        }
      },
      {
        "type": "category_comparison",
        "severity": "info",
        "message": "Grocery spending is 15% higher than last month",
        "data": {
          "currentMonth": 500.00,
          "previousMonth": 435.00,
          "difference": 65.00,
          "percentage": 15
        }
      }
    ]
  }
}
```

#### `GET /api/budgets/:id/predictions`
Get predictive analysis for budget exceedance.

**Response:**
```json
{
  "success": true,
  "data": {
    "budgetId": "uuid",
    "prediction": {
      "willExceed": true,
      "projectedSpending": 650.00,
      "projectedDate": "2025-10-28",
      "daysUntilExceedance": 10,
      "confidence": 0.85,
      "recommendedDailyBudget": 14.38,
      "currentDailyRate": 21.67
    }
  }
}
```

### Budget Alerts

#### `GET /api/budgets/alerts`
Get alerts for authenticated user.

**Query Parameters:**
- `budgetId` (optional): Filter by budget
- `unreadOnly` (optional): Show only unread alerts
- `limit` (default: 20): Number of alerts to return

**Response:**
```json
{
  "success": true,
  "data": {
    "alerts": [
      {
        "id": "uuid",
        "budgetId": "uuid",
        "budgetName": "Monthly Groceries",
        "alertType": "threshold",
        "threshold": 75,
        "currentSpending": 375.00,
        "budgetAmount": 500.00,
        "percentage": 75.00,
        "message": "You've spent 75% of your Monthly Groceries budget",
        "sentVia": ["push", "inApp"],
        "sentAt": "2025-10-15T10:30:00Z",
        "wasRead": false
      }
    ],
    "unreadCount": 3,
    "total": 15
  }
}
```

#### `PUT /api/budgets/alerts/:id/read`
Mark alert as read.

#### `PUT /api/budgets/alerts/read-all`
Mark all alerts as read for the user.

#### `GET /api/budgets/alerts/stats`
Get alert statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 45,
    "unread": 3,
    "byType": {
      "threshold": 30,
      "predictive": 8,
      "comparative": 5,
      "exceeded": 2
    },
    "last7Days": 5,
    "last30Days": 22
  }
}
```

### Notifications

#### `GET /api/notifications/preferences`
Get user notification preferences.

**Response:**
```json
{
  "success": true,
  "data": {
    "budgetAlerts": true,
    "receiptProcessing": true,
    "weeklyDigest": true,
    "monthlyDigest": true,
    "priceAlerts": true,
    "productRecommendations": false,
    "digestFrequency": "weekly",
    "digestDay": 0,
    "digestHour": 18,
    "channels": {
      "push": true,
      "email": false,
      "inApp": true
    },
    "quietHoursEnabled": true,
    "quietHoursStart": 22,
    "quietHoursEnd": 7,
    "timezone": "America/New_York"
  }
}
```

#### `PUT /api/notifications/preferences`
Update notification preferences.

#### `POST /api/notifications/fcm-token`
Register FCM token for push notifications.

**Request Body:**
```json
{
  "fcmToken": "dQw4w9WgXcQ:APA91bF...",
  "deviceInfo": {
    "platform": "android",
    "model": "Pixel 6",
    "osVersion": "13",
    "appVersion": "1.0.0"
  }
}
```

#### `DELETE /api/notifications/fcm-token`
Remove FCM token (disable push notifications).

#### `PUT /api/notifications/channels`
Update notification channels.

**Request Body:**
```json
{
  "channels": {
    "push": true,
    "email": false,
    "inApp": true
  }
}
```

#### `PUT /api/notifications/quiet-hours`
Set quiet hours (do not disturb).

**Request Body:**
```json
{
  "enabled": true,
  "start": 22,
  "end": 7
}
```

#### `PUT /api/notifications/digest`
Update digest settings.

**Request Body:**
```json
{
  "frequency": "weekly",
  "day": 0,
  "hour": 18,
  "weeklyEnabled": true,
  "monthlyEnabled": true
}
```

#### `POST /api/notifications/test`
Send test notification.

**Request Body:**
```json
{
  "channel": "all"
}
```

#### `GET /api/notifications/fcm/status`
Check FCM service health.

## Background Workers

### Budget Worker

The budget worker runs background jobs for:

1. **Alert Checking** (Every 6 hours)
   - Processes all active budgets
   - Checks spending against thresholds
   - Creates alerts if thresholds exceeded
   - Prevents duplicate alerts within 24 hours

2. **Budget Renewal** (Daily at 2 AM)
   - Finds expired recurring budgets
   - Handles rollover if enabled
   - Creates new budget periods
   - Deactivates old budgets

3. **Weekly Digest** (Sundays at 6 PM)
   - Finds users subscribed to weekly digest
   - Queues digest emails with spending summary

4. **Monthly Digest** (1st of month at 6 PM)
   - Finds users subscribed to monthly digest
   - Queues digest emails with monthly summary

### Worker Commands

```bash
# Workers auto-start in production
NODE_ENV=production node src/server.js

# Manual worker control via WorkerManager
const workerManager = require('./src/workers');

// Start all workers
await workerManager.start();

// Stop all workers
await workerManager.stop();

// Get health status
const health = workerManager.getHealthStatus();

// Get queue statistics
const stats = await workerManager.getQueueStatistics();

// Pause specific worker
await workerManager.pauseWorker('budget');

// Resume specific worker
await workerManager.resumeWorker('budget');
```

## Configuration

### Environment Variables

Add to `.env` file:

```bash
# Firebase Cloud Messaging (Required for push notifications)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json
FIREBASE_PROJECT_ID=your-project-id

# Redis (Required for background workers)
REDIS_URL=redis://localhost:6379

# Worker Configuration (Optional)
BUDGET_WORKER_CONCURRENCY=2
START_WORKERS=true

# Email Configuration (Optional for digest emails)
EMAIL_SERVICE=sendgrid
EMAIL_API_KEY=your-sendgrid-api-key
EMAIL_FROM=noreply@tallylens.com
EMAIL_FROM_NAME=TallyLens
```

### Firebase Setup

1. **Create Firebase Project**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create new project or select existing one

2. **Enable Cloud Messaging**
   - Navigate to Project Settings → Cloud Messaging
   - Enable Cloud Messaging API

3. **Download Service Account**
   - Go to Project Settings → Service Accounts
   - Click "Generate New Private Key"
   - Save JSON file securely
   - Set path in `GOOGLE_APPLICATION_CREDENTIALS`

4. **Get Server Key** (for Flutter)
   - Project Settings → Cloud Messaging
   - Copy "Server key" for Flutter app configuration

### Redis Setup

```bash
# Install Redis
# Ubuntu/Debian
sudo apt-get install redis-server

# macOS
brew install redis

# Start Redis
redis-server

# Verify connection
redis-cli ping  # Should return PONG
```

### Database Migration

Run migrations to create required tables:

```bash
# Apply migrations
npm run db:migrate

# Verify tables created
psql -d receipts_db -c "\dt"
# Should show: budgets, budget_alerts, notification_preferences
```

## Testing

### Manual API Testing

```bash
# 1. Login and get token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'

# Save the token
TOKEN="your_jwt_token_here"

# 2. Create a budget
curl -X POST http://localhost:3000/api/budgets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Monthly Groceries",
    "category": "grocery",
    "amount": 500,
    "period": "monthly",
    "startDate": "2025-10-01",
    "endDate": "2025-10-31",
    "isRecurring": true,
    "allowRollover": true
  }'

# 3. Check budget progress
BUDGET_ID="budget_uuid_from_create_response"
curl -X GET "http://localhost:3000/api/budgets/$BUDGET_ID/progress" \
  -H "Authorization: Bearer $TOKEN"

# 4. Get budget insights
curl -X GET "http://localhost:3000/api/budgets/$BUDGET_ID/insights" \
  -H "Authorization: Bearer $TOKEN"

# 5. Register FCM token
curl -X POST http://localhost:3000/api/notifications/fcm-token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "fcmToken": "your_fcm_token",
    "deviceInfo": {
      "platform": "android",
      "model": "Pixel 6"
    }
  }'

# 6. Get notification preferences
curl -X GET http://localhost:3000/api/notifications/preferences \
  -H "Authorization: Bearer $TOKEN"

# 7. Send test notification
curl -X POST http://localhost:3000/api/notifications/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"channel": "all"}'
```

### Automated Tests

```bash
# Run all tests
npm test

# Run budget-specific tests
npm test -- --grep "Budget"

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Testing Worker Jobs

```bash
# Start server with workers enabled
START_WORKERS=true npm run dev

# Watch worker logs
tail -f logs/combined.log | grep -i budget

# Manual job triggering (via Node REPL)
node
> const queueService = require('./src/services/queueService').default;
> await queueService.queues.budget.add('check-alerts', { type: 'manual', timestamp: new Date() });

# Check queue statistics
> const workerManager = require('./src/workers').default;
> const stats = await workerManager.getQueueStatistics();
> console.log(stats.budget);
```

## Troubleshooting

### Push Notifications Not Working

1. **Check Firebase Configuration**
   ```bash
   # Verify service account file exists
   ls -la $GOOGLE_APPLICATION_CREDENTIALS

   # Check Firebase connection
   curl -X GET http://localhost:3000/api/notifications/fcm/status \
     -H "Authorization: Bearer $TOKEN"
   ```

2. **Verify FCM Token**
   - Ensure token is valid and not expired
   - Check device has internet connection
   - Verify app has notification permissions

3. **Check Logs**
   ```bash
   tail -f logs/error.log | grep -i fcm
   ```

### Workers Not Processing Jobs

1. **Verify Redis Connection**
   ```bash
   redis-cli ping
   # Should return PONG
   ```

2. **Check Worker Status**
   ```bash
   curl -X GET http://localhost:3000/api/health/detailed
   # Check workers.budget.isRunning = true
   ```

3. **Inspect Queue**
   ```bash
   # Via Redis CLI
   redis-cli
   > KEYS bull:Budget:*
   > LLEN bull:Budget:waiting
   ```

### Alerts Not Being Sent

1. **Check Alert Thresholds**
   - Verify spending exceeds threshold
   - Check if similar alert was sent recently (24h cooldown)

2. **Verify Notification Preferences**
   ```bash
   curl -X GET http://localhost:3000/api/notifications/preferences \
     -H "Authorization: Bearer $TOKEN"
   ```

3. **Check Quiet Hours**
   - Alerts suppressed during quiet hours
   - Verify current time is outside quiet hours range

### Database Issues

1. **Check Migrations**
   ```bash
   # List applied migrations
   psql -d receipts_db -c "SELECT * FROM sequelize_meta;"

   # Verify tables exist
   psql -d receipts_db -c "\d budgets"
   ```

2. **Check Constraints**
   ```bash
   # View budget constraints
   psql -d receipts_db -c "\d+ budgets"
   ```

## Performance Considerations

### Caching Strategy

Budget endpoints use Redis caching with the following TTLs:

- **Progress**: 5 minutes
- **Summary**: 10 minutes
- **Insights**: 1 hour
- **Predictions**: 30 minutes

Cache is automatically invalidated on:
- Budget creation/update/deletion
- New receipt creation
- Receipt amount/category update

### Database Optimization

Indexes created on:
- `budgets.user_id` (foreign key)
- `budgets.is_active` (filtering)
- `budget_alerts.user_id` (foreign key)
- `budget_alerts.was_read` (filtering)
- `budget_alerts.sent_at` (sorting)
- `notification_preferences.user_id` (unique)

### Queue Configuration

Budget queue settings:
- **Concurrency**: 2 (configurable via `BUDGET_WORKER_CONCURRENCY`)
- **Retry Attempts**: 3
- **Backoff**: Exponential (5s base delay)
- **Remove on Complete**: Keep last 10
- **Remove on Fail**: Keep last 5

## Security

### Authentication

All budget and notification endpoints require JWT authentication:

```javascript
Authorization: Bearer <jwt_token>
```

### Authorization

- Users can only access their own budgets and alerts
- Budget IDs are UUIDs (not sequential integers)
- All inputs validated and sanitized

### Data Privacy

- FCM tokens encrypted at rest
- Device info sanitized before storage
- User can delete FCM token at any time
- Email addresses never shared with third parties

## Monitoring

### Health Checks

```bash
# Basic health
curl http://localhost:3000/api/health

# Detailed health (includes worker status)
curl http://localhost:3000/api/health/detailed

# Metrics
curl http://localhost:3000/api/health/metrics
```

### Logs

Logs are written to:
- `logs/combined.log` - All logs
- `logs/error.log` - Errors only
- `logs/budget-worker.log` - Worker-specific logs

Log levels (configurable via `LOG_LEVEL`):
- `error` - Production default
- `warn` - Warnings and errors
- `info` - Info, warnings, and errors
- `debug` - All logs including debug

## Support

For issues or questions:

1. Check this README
2. Review logs in `logs/` directory
3. Check existing issues on GitHub
4. Create new issue with:
   - Error messages
   - Steps to reproduce
   - Environment details (Node version, OS, etc.)

## Changelog

### v1.0.0 (2025-10-05)

- Initial release of Budgets & Smart Alerts feature
- Support for flexible budget periods
- Predictive alerts with ML-based analysis
- Multi-channel notifications (Push, Email, In-App)
- Recurring budgets with rollover support
- Weekly and monthly digest emails
- AI-generated spending insights
- Background worker for automated processing
- Comprehensive i18n support (EN, ES, NL)
