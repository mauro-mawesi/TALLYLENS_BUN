# Contributing to TallyLens Backend

Thank you for considering contributing to TallyLens! This document provides guidelines for contributing to the project.

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help create a welcoming environment for all contributors

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [GitHub Issues](https://github.com/mauro-mawesi/TALLYLENS_BUN/issues)
2. If not, create a new issue with:
   - Clear, descriptive title
   - Steps to reproduce the bug
   - Expected vs actual behavior
   - Environment details (OS, Node version, etc.)
   - Relevant logs or screenshots

### Suggesting Features

1. Check if the feature has been suggested in [GitHub Issues](https://github.com/mauro-mawesi/TALLYLENS_BUN/issues)
2. Create a new issue with:
   - Clear description of the feature
   - Use cases and benefits
   - Potential implementation approach (optional)

### Pull Requests

#### Before You Start

1. Fork the repository
2. Clone your fork locally
3. Create a new branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

#### Development Workflow

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment**:
   ```bash
   cp .env.example .env
   # Configure your .env file
   ```

3. **Run database migrations**:
   ```bash
   npm run db:migrate
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

5. **Make your changes**:
   - Follow the existing code style
   - Write clear, descriptive commit messages
   - Add tests for new functionality
   - Update documentation as needed

6. **Test your changes**:
   ```bash
   # Run all tests
   npm test

   # Run specific tests
   npm test -- path/to/test

   # Check coverage
   npm run test:coverage
   ```

7. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

#### Commit Message Guidelines

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

Examples:
```
feat: add receipt bulk upload endpoint
fix: resolve JWT token expiration issue
docs: update API documentation for receipts
test: add integration tests for auth service
```

#### Code Style

- Use ES6+ features
- Follow existing patterns in the codebase
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused
- Handle errors appropriately

#### Testing Requirements

- Write unit tests for business logic
- Write integration tests for API endpoints
- Ensure all tests pass before submitting
- Aim for at least 70% code coverage
- Test edge cases and error scenarios

#### Pull Request Checklist

Before submitting your PR, ensure:

- [ ] Code follows project style guidelines
- [ ] All tests pass (`npm test`)
- [ ] New tests added for new functionality
- [ ] Documentation updated (if applicable)
- [ ] No console.log or debug code left behind
- [ ] Environment variables documented in `.env.example`
- [ ] Commit messages follow conventional commits
- [ ] PR description clearly explains changes

#### Pull Request Process

1. Push your branch to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

2. Open a Pull Request on GitHub with:
   - Clear title and description
   - Reference to related issues (if any)
   - Screenshots/videos (if UI changes)
   - Test results

3. Address review feedback promptly

4. Once approved, your PR will be merged by a maintainer

## Project Structure

```
backend/
├── src/
│   ├── config/          # App configuration
│   ├── controllers/     # Request handlers
│   ├── middlewares/     # Express middlewares
│   ├── models/          # Sequelize models
│   ├── routes/          # API routes
│   ├── services/        # Business logic
│   ├── utils/           # Helper functions
│   └── workers/         # Background jobs
├── migrations/          # Database migrations
├── tests/               # Test files
└── docs/                # Documentation
```

## Development Tips

### Database Changes

1. Create a migration:
   ```bash
   npx sequelize-cli migration:generate --name your-migration-name
   ```

2. Write up and down methods in the migration

3. Test the migration:
   ```bash
   npm run db:migrate
   npm run db:migrate:undo
   ```

### Adding New API Endpoints

1. Create route in `src/routes/`
2. Create controller in `src/controllers/`
3. Create service logic in `src/services/`
4. Add validation middleware
5. Document in Swagger annotations
6. Write integration tests

### Background Jobs

1. Create worker in `src/workers/`
2. Register in `src/workers/index.js`
3. Define queue processing logic
4. Add error handling and retries
5. Write unit tests

## Getting Help

- Open a [GitHub Issue](https://github.com/mauro-mawesi/TALLYLENS_BUN/issues) for questions
- Check existing issues and documentation first
- Provide context and details when asking for help

## Recognition

Contributors will be acknowledged in:
- Project README
- Release notes
- GitHub contributors page

Thank you for contributing to TallyLens!
