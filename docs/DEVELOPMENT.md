# Development Guide

## Getting Started with Development

### Prerequisites
- Git
- Node.js v14 or higher
- npm or yarn
- Your favorite code editor (VS Code recommended)

### Initial Setup

1. Clone the repository
```bash
git clone https://github.com/AchieverBangs/reliavolt-inventory.git
cd reliavolt-inventory
```

2. Create a development branch
```bash
git checkout -b feature/your-feature-name
```

3. Set up frontend
```bash
cd frontend
npm install
cp .env.example .env.local
```

4. Set up backend
```bash
cd ../backend
npm install
cp .env.example .env.local
```

## Development Workflow

### Running Development Servers

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm start
```

### Git Workflow

1. Create feature branch from main
2. Make changes
3. Commit with clear messages
4. Push to GitHub
5. Create Pull Request
6. Request review
7. Merge after approval

### Commit Message Format

```
[TYPE] Brief description

Optional longer description explaining the changes.

Types: feat, fix, docs, style, refactor, test, chore
```

Example:
```
[feat] Add user authentication

Implemented JWT-based authentication with login and registration endpoints.
```

## Testing

### Running Tests

**Backend:**
```bash
cd backend
npm test
```

**Frontend:**
```bash
cd frontend
npm test
```

## Code Style

- Use ESLint for JavaScript/TypeScript
- Use Prettier for code formatting
- Follow component naming conventions
- Write meaningful variable and function names

## Troubleshooting

### Port Already in Use
```bash
# Kill process on port 3000 (macOS/Linux)
lsof -ti:3000 | xargs kill -9

# Or use different ports
# Backend: change PORT in .env
# Frontend: PORT=3001 npm start
```

### Dependencies Issues
```bash
# Clear npm cache and reinstall
rm -rf node_modules package-lock.json
npm install
```
