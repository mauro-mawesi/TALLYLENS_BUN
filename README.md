# TallyLens Backend

Production-ready receipt management API built with Node.js, Express, and PostgreSQL.

## Features

- **Authentication & Authorization**: JWT-based authentication with refresh tokens, role-based access control
- **Receipt Management**: Full CRUD operations with OCR text extraction and AI-powered categorization
- **Image Processing**: Google Cloud Vision API integration for OCR, automated receipt categorization
- **Performance**: Redis caching layer, background job processing with Bull queues
- **Security**: Comprehensive rate limiting, input validation, security headers, CORS configuration
- **Monitoring**: Health checks, structured logging, metrics endpoints
- **Database**: PostgreSQL with Sequelize ORM, migrations, and seeding
- **Testing**: Jest unit and integration tests with coverage reports
- **API Documentation**: Swagger/OpenAPI interactive documentation

## Tech Stack

- **Runtime**: Node.js with Bun support
- **Framework**: Express.js
- **Database**: PostgreSQL 14+
- **ORM**: Sequelize
- **Caching**: Redis 6+
- **Queue**: Bull (Redis-based)
- **Authentication**: JWT with refresh tokens
- **OCR**: Google Cloud Vision API
- **AI**: OpenRouter API (GPT-4 Mini)
- **Testing**: Jest
- **Documentation**: Swagger UI

## Prerequisites

- Node.js 18+ or Bun 1.0+
- PostgreSQL 14+
- Redis 6+ (optional but recommended for production)
- Google Cloud Platform account with Vision API enabled
- OpenRouter API key

## Quick Start

### 1. Clone and Install

```bash
git clone git@github.com:mauro-mawesi/TALLYLENS_BUN.git
cd TALLYLENS_BUN
npm install  # or: bun install
```

### 2. Environment Configuration

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

**Required environment variables:**

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/receipts_db

# Security (generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_SECRET=your_secure_jwt_secret_here
JWT_REFRESH_SECRET=your_secure_refresh_secret_here

# APIs
OPENROUTER_API_KEY=your_openrouter_api_key
GOOGLE_APPLICATION_CREDENTIALS=path/to/google-credentials.json

# Optional
REDIS_URL=redis://localhost:6379
NODE_ENV=development
PORT=3000
```

### 3. Database Setup

```bash
# Run migrations
npm run db:migrate

# Seed database (optional)
npm run db:seed
```

### 4. Start the Server

```bash
# Development with hot reload
npm run dev

# Production
npm start
```

The API will be available at `http://localhost:3000`

## API Documentation

Once the server is running, visit:

- **Swagger UI**: `http://localhost:3000/api-docs`
- **OpenAPI Spec**: `http://localhost:3000/api-docs.json`

## API Endpoints

### Authentication

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Receipts

- `GET /api/receipts` - List receipts (with pagination and filters)
- `GET /api/receipts/:id` - Get receipt details
- `POST /api/receipts` - Create receipt
- `PUT /api/receipts/:id` - Update receipt
- `DELETE /api/receipts/:id` - Delete receipt
- `GET /api/receipts/stats` - Get user statistics

### File Upload

- `POST /api/upload` - Upload receipt image

### Health & Monitoring

- `GET /api/health` - Basic health check
- `GET /api/health/detailed` - Comprehensive health status
- `GET /api/health/metrics` - Application metrics

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Database Migrations

```bash
# Create new migration
npx sequelize-cli migration:generate --name migration-name

# Run pending migrations
npm run db:migrate

# Rollback last migration
npm run db:migrate:undo

# Reset database
npm run db:reset
```

### Code Quality

```bash
# Lint code
npm run lint

# Format code
npm run format
```

## Docker Support

### Development

```bash
docker-compose up -d
```

### Production

```bash
docker-compose -f docker-compose.prod.yml up -d
```

## Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration files
│   ├── controllers/     # Request handlers
│   ├── middlewares/     # Express middlewares
│   ├── models/          # Sequelize models
│   ├── routes/          # API routes
│   ├── services/        # Business logic
│   ├── utils/           # Utility functions
│   └── workers/         # Background job processors
├── migrations/          # Database migrations
├── tests/               # Test files
├── docs/                # Additional documentation
├── .env.example         # Environment variables template
├── package.json
└── README.md
```

## Security

- **Authentication**: JWT access tokens (15min) + refresh tokens (7 days)
- **Password Hashing**: bcrypt with configurable rounds
- **Rate Limiting**: Per-endpoint and per-user limits
- **Input Validation**: Comprehensive validation and sanitization
- **Security Headers**: Helmet.js for standard security headers
- **CORS**: Configurable CORS policies
- **SQL Injection**: Protected via Sequelize ORM parameterization

## Performance

- **Caching**: Multi-layer Redis caching strategy
- **Background Jobs**: Async processing for OCR and categorization
- **Connection Pooling**: Database connection pooling
- **Response Compression**: Gzip compression middleware
- **Indexing**: Optimized database indexes

## Monitoring

- **Health Checks**: `/api/health` endpoints for liveness/readiness probes
- **Logging**: Structured JSON logging with Winston
- **Metrics**: Application metrics endpoint for Prometheus/Grafana
- **Error Tracking**: Centralized error handling and logging

## License

MIT

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/mauro-mawesi/TALLYLENS_BUN/issues) page.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

Built with ❤️ using Node.js and Express
