# Bookmarks Manager

[English](README.md) | [中文](README.zh-CN.md)

A feature-rich self-hosted bookmark manager built with Fastify + TypeScript + Alpine.js + SQLite.

## ✨ Features

### Core Features
- **Bookmark Management**: Add, edit, delete, and move bookmarks
- **Category Management**: Multi-level categories with batch operations
- **Import/Export**: Support for browser bookmark HTML, JSON, and TXT formats
- **URL Deduplication**: Automatic deduplication based on normalized URLs

### Bookmark Validation
- **Batch Checking**: Validate bookmark link availability
- **High Concurrency**: Support for 30+ concurrent checks (configurable)
- **Smart Retry**: Automatic retry on failure with configurable attempts and intervals
- **Skip Checking**: Mark specific bookmarks to skip validation
- **Periodic Checks**: Support for weekly/monthly automatic checks (runs at night)

### AI Features
- **AI Classification**: Automatically categorize bookmarks using OpenAI-compatible APIs
- **AI Simplification**: Intelligently merge similar categories to simplify structure
- **Batch Processing**: Support for bulk AI classification

### Security Features
- **User Authentication**: Built-in login system with password change support
- **API Tokens**: Generate multiple API tokens for browser extensions and third-party apps
- **IP Lockout**: Lock IP for 30 minutes after 10 failed login attempts
- **Session Management**: Secure session handling

### Additional Features
- **Browser Extension**: One-click bookmark saving from current page
- **Task Queue**: Background task processing with cancellation support
- **Real-time Progress**: SSE-based real-time task progress display
- **Auto Backup**: Scheduled database backups
- **Responsive UI**: Modern web interface

## 🚀 Quick Start

### Docker Deployment (Recommended)

```bash
# Clone the repository
git clone https://github.com/ZWXT01/bookmarks-manager.git
cd bookmarks-manager

# Start the service
docker compose up -d --build

# Access http://localhost:8080
# Default credentials: admin / admin
```

### Local Development

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build
npm run build

# Production mode
npm start
```

## ⚙️ Environment Variables

### Basic Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Listen port | `8080` |
| `DB_PATH` | SQLite file path | `./data/app.db` |
| `SESSION_SECRET` | Session secret key | Auto-generated |

### Authentication Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_USERNAME` | Default username | `admin` |
| `AUTH_PASSWORD` | Default password | `admin` |
| `API_TOKEN` | Static API token (optional) | - |

### Check Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `CHECK_CONCURRENCY` | Check concurrency | `30` |
| `CHECK_TIMEOUT_MS` | Check timeout (ms) | `5000` |
| `CHECK_RETRIES` | Retry attempts on failure | `1` |
| `CHECK_RETRY_DELAY_MS` | Retry delay (ms) | `500` |

### Periodic Check Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `PERIODIC_CHECK_ENABLED` | Enable periodic checks | `0` |
| `PERIODIC_CHECK_SCHEDULE` | Check schedule (`weekly`/`monthly`) | `weekly` |
| `PERIODIC_CHECK_HOUR` | Execution hour (2-5 AM) | `2` |

### Backup Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `BACKUP_ENABLED` | Enable auto backup | `0` |
| `BACKUP_INTERVAL_MINUTES` | Backup interval (minutes) | `1440` |
| `BACKUP_RETENTION` | Number of backups to keep | `10` |
| `BACKUP_DIR` | Backup directory | `./data/backups` |

## 🔑 API Tokens

API tokens allow browser extensions or third-party apps to access the API without cookie authentication.

### Generate Token

1. Log in to the web management interface
2. Go to the "Settings" page
3. Click "Create Token" in the "API Tokens" section
4. Enter a name and select expiration (optional)
5. **Copy and save the token immediately** (shown only once)

### Use Token

Add the Authorization header to API requests:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-domain.com/api/bookmarks
```

### Token Management

- Support for multiple tokens for different applications
- Configurable expiration: 7 days / 30 days / 90 days / 1 year / never
- Delete unused tokens anytime
- System automatically cleans up expired tokens

## 🔌 Browser Extension

The project includes a browser extension for one-click bookmark saving.

### Install Extension

1. Open browser extension management page
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Firefox: `about:addons`
2. Enable "Developer mode"
3. Click "Load unpacked extension"
4. Select the `extension` folder from the project

### Configure Extension

1. Click the extension icon and expand "⚙️ Settings"
2. Enter server address (e.g., `https://bookmarks.example.com`)
3. Enter API token (generated from web settings page)
4. Click "Save Settings"

### Use Extension

1. Browse any webpage
2. Click the extension icon
3. Select category (optional)
4. Click "Save Bookmark"

## 📁 Project Structure

```
bookmarks-manager/
├── src/                    # TypeScript source code
│   ├── index.ts           # Main entry, route definitions
│   ├── db.ts              # Database initialization
│   ├── auth.ts            # Authentication module (with API tokens)
│   ├── checker.ts         # Bookmark checker
│   ├── importer.ts        # Import module
│   ├── exporter.ts        # Export module
│   ├── jobs.ts            # Task queue
│   ├── ai-organize.ts     # AI organizer
│   └── ai-organize-plan.ts # AI organize planner
├── views/                  # EJS templates
├── public/                 # Static assets
├── extension/              # Browser extension
├── data/                   # Data directory (Docker mount)
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 🔧 API Endpoints

All API endpoints require authentication (Session or API Token).

### Authentication Methods

```bash
# Method 1: API Token (recommended for extensions and scripts)
curl -H "Authorization: Bearer YOUR_TOKEN" https://your-domain.com/api/bookmarks

# Method 2: Session Cookie (used by web interface)
```

### Bookmark Management
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bookmarks` | Get bookmark list (with search/filter) |
| POST | `/api/bookmarks` | Add bookmark |
| PUT | `/api/bookmarks/:id` | Update bookmark |
| DELETE | `/api/bookmarks/:id` | Delete bookmark |

### Category Management
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/categories` | Get category list |
| POST | `/api/categories` | Add category |
| PUT | `/api/categories/:id` | Update category |
| DELETE | `/api/categories/:id` | Delete category |

### Token Management
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tokens` | Get token list |
| POST | `/api/tokens` | Create new token |
| DELETE | `/api/tokens/:id` | Delete token |

### Check Features
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/check/start` | Start batch check |
| POST | `/api/check/one/:id` | Check single bookmark |

### AI Features
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ai/classify` | AI classification |
| POST | `/api/ai/simplify` | AI simplify categories |
| POST | `/api/ai/apply-simplify` | Apply simplification suggestions |

## 🔍 Advanced Search

`GET /api/bookmarks` supports the following query parameters:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `q` | Search keywords (space-separated) | `github python` |
| `category` | Category ID or `uncategorized` | `1` |
| `status` | Check status | `ok` / `fail` / `not_checked` |
| `skip_check` | Skip checking | `1` / `0` |
| `date_from` | Start date | `2024-01-01` |
| `date_to` | End date | `2024-12-31` |
| `domain` | Domain filter | `github.com` |
| `sort` | Sort field | `id` / `title` / `created_at` |
| `order` | Sort direction | `asc` / `desc` |
| `page` | Page number | `1` |
| `pageSize` | Items per page | `50` |

## 🔒 Security Recommendations

### Production Deployment

1. **Change Default Password**: Change immediately after first login
2. **Use HTTPS**: Configure SSL via Nginx reverse proxy
3. **Restrict Access**: Configure IP whitelist or VPN
4. **Regular Backups**: Enable auto backup feature
5. **Token Management**: Regularly clean up unused tokens, set reasonable expiration

### Nginx Reverse Proxy Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name bookmarks.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600;
    }
}
```

## 📦 Data Backup and Migration

### Manual Backup

```bash
# Docker deployment
docker compose exec app sqlite3 /data/app.db ".backup '/data/backup.db'"

# Or direct copy
cp ./data/app.db ./data/app.db.backup
```

### Data Migration

```bash
# On new server
mkdir -p ./data
scp old-server:/path/to/data/app.db ./data/
docker compose up -d
```

## 🐛 Troubleshooting

### Extension Shows "Network Error"

1. Check if server address is correct (include `https://`)
2. Confirm API token is properly configured
3. Check if server is running
4. View browser console for error messages

### SSE Progress Not Updating

Caused by Nginx buffering, add configuration:
```nginx
proxy_buffering off;
```

### High Check Failure Rate

1. Increase timeout: `CHECK_TIMEOUT_MS=10000`
2. Increase retries: `CHECK_RETRIES=2`
3. Reduce concurrency: `CHECK_CONCURRENCY=10`

### AI Classification Not Working

1. Check AI configuration (Base URL, API Key, Model)
2. Use "Test Connection" feature on settings page
3. Ensure API quota is sufficient

## 📄 License

MIT License
