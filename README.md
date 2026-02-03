# TRH Desktop

One-click desktop application for [Tokamak Rollup Hub](https://github.com/tokamak-network). Deploy L2 rollups without touching the command line.

## Features

- Automatic Docker container orchestration
- Built-in setup wizard with dependency checking
- System tray integration for background operation
- Cross-platform support (macOS, Windows, Linux)

## Requirements

- **Docker Desktop** - Required for running the platform services
- **Node.js 18+** - For development only

## Quick Start

### For Users

1. Download the latest release from [Releases](https://github.com/tokamak-network/trh-platform-desktop/releases)
2. Install and open TRH Desktop
3. Follow the setup wizard

### For Developers

```bash
# Clone the repository
git clone https://github.com/tokamak-network/trh-platform-desktop.git
cd trh-platform-desktop

# Install dependencies
npm install

# Build required Docker images (see Docker Images section)

# Run in development mode
npm run dev
```

## Docker Images

This application requires the following Docker images to be available locally:

| Image | Source |
|-------|--------|
| `trh-backend:electron` | Built from [trh-backend](https://github.com/tokamak-network/trh-backend) |
| `trh-platform-ui:electron` | Built from [trh-platform-ui](https://github.com/tokamak-network/trh-platform-ui) |
| `postgres:15-alpine` | Pulled from Docker Hub |

### Building the Backend Image

```bash
git clone https://github.com/tokamak-network/trh-backend.git
cd trh-backend
# Use main branch or specific release tag when available
git checkout feat/cross-trade-integration
docker build -t trh-backend:electron .
```

### Building the Platform UI Image

```bash
git clone https://github.com/tokamak-network/trh-platform-ui.git
cd trh-platform-ui
# Use main branch or specific release tag when available
git checkout feat/update-cross-trade
docker build -t trh-platform-ui:electron .
```

## Development

```bash
# Run in development mode
npm run dev

# Watch mode (auto-recompile)
npm run dev:watch

# Build TypeScript only
npm run build
```

## Building Releases

```bash
# Build for current platform
npm run package

# Build for specific platforms
npm run package:mac
npm run package:win
npm run package:linux
```

Build output is in the `release/` directory.

> **Note:** Windows builds require `icon.ico`. Use a tool like ImageMagick to convert `icon.png`:
> ```bash
> convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
> ```

## Project Structure

```
trh-platform-desktop/
├── src/main/
│   ├── index.ts        # Electron main process
│   ├── preload.ts      # IPC bridge (renderer ↔ main)
│   └── docker.ts       # Docker container management
├── public/
│   ├── setup.html      # Setup wizard UI
│   └── assets/         # Images, icons, logos
├── resources/
│   └── docker-compose.yml
└── package.json
```

## How It Works

1. **Setup Wizard** - Checks Docker installation and pulls required images
2. **Container Orchestration** - Starts PostgreSQL, backend API, and platform UI
3. **Dependency Installation** - Installs required tools (pnpm, node, forge, aws) in the backend container
4. **Health Monitoring** - Waits for all services to be healthy before loading the UI
5. **Platform UI** - Loads the web interface at `http://localhost:3000`

## Ports Used

| Service | Port |
|---------|------|
| Platform UI | 3000 |
| Backend API | 8000 |
| PostgreSQL | 5433 |

## License

[MIT](LICENSE)

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## Related Projects

- [trh-backend](https://github.com/tokamak-network/trh-backend) - Backend API
- [trh-platform-ui](https://github.com/tokamak-network/trh-platform-ui) - Platform UI
- [tokamak-network](https://github.com/tokamak-network) - Tokamak Network organization
