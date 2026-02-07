import { spawn, exec, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { app } from 'electron';

const COMMAND_TIMEOUT = 30000;
const HEALTH_CHECK_TIMEOUT = 120000;
const HEALTH_CHECK_INTERVAL = 3000;
const PULL_TIMEOUT = 600000;
const COMPOSE_TIMEOUT = 120000;

const REQUIRED_PORTS = [3000, 5433, 8000];
const activeProcesses = new Set<ChildProcess>();

let logCallback: ((line: string) => void) | null = null;

export function setLogCallback(cb: ((line: string) => void) | null): void {
  logCallback = cb;
}

function emitLog(line: string): void {
  if (logCallback && line.trim()) {
    logCallback(line.trim());
  }
}

const DOCKER_PATHS = [
  '/usr/local/bin/docker',
  '/opt/homebrew/bin/docker',
  '/usr/bin/docker',
  '/Applications/Docker.app/Contents/Resources/bin/docker'
];

const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH || ''}`;

function findDocker(): string {
  for (const p of DOCKER_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return 'docker';
}

const DOCKER_BIN = findDocker();

export interface DockerStatus {
  installed: boolean;
  running: boolean;
  containersUp: boolean;
  healthy: boolean;
  error?: string;
}

export interface PullProgress {
  service: string;
  status: string;
  progress?: string;
}

export interface ContainerConfig {
  adminEmail?: string;
  adminPassword?: string;
}

export interface BackendDependencies {
  pnpm: boolean;
  node: boolean;
  forge: boolean;
  aws: boolean;
  allInstalled: boolean;
}

function getComposePath(): string {
  const composePath = app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'docker-compose.yml')
    : path.join(__dirname, '..', '..', 'resources', 'docker-compose.yml');

  if (!fs.existsSync(composePath)) {
    throw new Error(`Docker Compose file not found: ${composePath}`);
  }
  return composePath;
}

function execPromise(command: string, timeout = COMMAND_TIMEOUT): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout, env: { ...process.env, PATH: EXTENDED_PATH } }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

export async function checkRequiredPorts(): Promise<{ available: boolean; blockedPorts: number[] }> {
  const blockedPorts: number[] = [];
  for (const port of REQUIRED_PORTS) {
    if (!(await isPortAvailable(port))) {
      blockedPorts.push(port);
    }
  }
  return { available: blockedPorts.length === 0, blockedPorts };
}

export interface PortConflict {
  port: number;
  pid: number;
  processName: string;
}

export async function getPortConflicts(): Promise<{ available: boolean; conflicts: PortConflict[] }> {
  const portCheck = await checkRequiredPorts();
  if (portCheck.available) {
    return { available: true, conflicts: [] };
  }

  const conflicts: PortConflict[] = [];
  for (const port of portCheck.blockedPorts) {
    try {
      const pidOutput = await execPromise(`lsof -i :${port} -t -sTCP:LISTEN`);
      const pids = pidOutput.split('\n').map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 0);
      for (const pid of pids) {
        try {
          const name = await execPromise(`ps -p ${pid} -o comm=`);
          conflicts.push({ port, pid, processName: name.trim() });
        } catch {
          conflicts.push({ port, pid, processName: 'unknown' });
        }
      }
    } catch {
      // lsof failed — port is blocked but can't identify the process
      emitLog(`Could not identify process on port ${port}`);
    }
  }

  return { available: false, conflicts };
}

export async function killPortProcesses(ports: number[]): Promise<void> {
  for (const port of ports) {
    try {
      const pidOutput = await execPromise(`lsof -i :${port} -t -sTCP:LISTEN`);
      const pids = pidOutput.split('\n').map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 0);
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGTERM');
          emitLog(`Killed process ${pid} on port ${port}`);
        } catch (err) {
          emitLog(`Could not kill process ${pid} on port ${port}: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    } catch {
      // No process found on port, already free
    }
  }

  // Wait for processes to terminate
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Verify ports are freed
  for (const port of ports) {
    if (!(await isPortAvailable(port))) {
      throw new Error(`Port ${port} is still in use after killing processes. You may need to free it manually.`);
    }
  }
}

export function cleanupProcesses(): void {
  activeProcesses.forEach(proc => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 5000);
    }
  });
  activeProcesses.clear();
}

function validateCredentials(config?: ContainerConfig): { email?: string; password?: string } {
  const result: { email?: string; password?: string } = {};

  if (config?.adminEmail) {
    const email = String(config.adminEmail).trim();
    if (email.length > 254) throw new Error('Email address too long');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email format');
    result.email = email;
  }

  if (config?.adminPassword) {
    const password = String(config.adminPassword);
    if (password.length > 128) throw new Error('Password too long');
    if (password.length < 8) throw new Error('Password must be at least 8 characters');
    result.password = password;
  }

  return result;
}

export async function isDockerInstalled(): Promise<boolean> {
  try {
    await execPromise(`"${DOCKER_BIN}" --version`);
    return true;
  } catch {
    return false;
  }
}

export async function isDockerRunning(): Promise<boolean> {
  try {
    await execPromise(`"${DOCKER_BIN}" info`);
    return true;
  } catch {
    return false;
  }
}

export async function getDockerStatus(): Promise<DockerStatus> {
  const installed = await isDockerInstalled();
  if (!installed) {
    return { installed: false, running: false, containersUp: false, healthy: false };
  }

  const running = await isDockerRunning();
  if (!running) {
    return { installed: true, running: false, containersUp: false, healthy: false };
  }

  try {
    const psOutput = await execPromise(
      `"${DOCKER_BIN}" compose -f "${getComposePath()}" ps --format json`
    );

    if (!psOutput) {
      return { installed: true, running: true, containersUp: false, healthy: false };
    }

    const containers = psOutput
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); }
        catch { return null; }
      })
      .filter(Boolean);

    const allUp = containers.length >= 3 && containers.every((c: any) => c.State === 'running');
    const allHealthy = containers.every((c: any) => !c.Health || c.Health === 'healthy');

    return { installed: true, running: true, containersUp: allUp, healthy: allUp && allHealthy };
  } catch (error) {
    return {
      installed: true,
      running: true,
      containersUp: false,
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function pullImages(onProgress: (progress: PullProgress) => void): Promise<void> {
  const composePath = getComposePath();

  return new Promise((resolve, reject) => {
    const pull = spawn(DOCKER_BIN, ['compose', '-f', composePath, 'pull'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: EXTENDED_PATH }
    });

    activeProcesses.add(pull);

    const timeout = setTimeout(() => {
      pull.kill('SIGTERM');
      reject(new Error('Image pull timed out after 10 minutes. Check your internet connection.'));
    }, PULL_TIMEOUT);

    const parseOutput = (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        emitLog(line);
        const match = line.match(/^(\w+[-\w]*)\s+(.+)$/);
        if (match) {
          onProgress({ service: match[1], status: match[2] });
        } else {
          onProgress({ service: 'docker', status: line.trim() });
        }
      }
    };

    pull.stdout.on('data', parseOutput);
    pull.stderr.on('data', parseOutput);

    pull.on('close', code => {
      clearTimeout(timeout);
      activeProcesses.delete(pull);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker pull failed with code ${code}. Check if images exist or network is available.`));
      }
    });

    pull.on('error', (err) => {
      clearTimeout(timeout);
      activeProcesses.delete(pull);
      reject(err);
    });
  });
}

export async function startContainers(config?: ContainerConfig): Promise<void> {
  const composePath = getComposePath();
  const credentials = validateCredentials(config);

  const env: NodeJS.ProcessEnv = { ...process.env, PATH: EXTENDED_PATH };
  if (credentials.email) env.ADMIN_EMAIL = credentials.email;
  if (credentials.password) env.ADMIN_PASSWORD = credentials.password;

  return new Promise((resolve, reject) => {
    const up = spawn(DOCKER_BIN, ['compose', '-f', composePath, 'up', '-d'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });

    activeProcesses.add(up);

    const timeout = setTimeout(() => {
      up.kill('SIGTERM');
      reject(new Error('Container startup timed out. Docker may be unresponsive.'));
    }, COMPOSE_TIMEOUT);

    let stderrOutput = '';
    up.stdout.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => emitLog(line));
    });
    up.stderr.on('data', (data) => {
      const text = data.toString();
      stderrOutput += text;
      text.split('\n').filter(Boolean).forEach((line: string) => emitLog(line));
    });

    up.on('close', code => {
      clearTimeout(timeout);
      activeProcesses.delete(up);
      if (code === 0) {
        resolve();
      } else {
        let errorMsg = `Docker compose up failed with code ${code}.`;
        if (stderrOutput.includes('port is already allocated')) {
          errorMsg = 'Port conflict detected. Another process is using required ports.';
        } else if (stderrOutput.includes('No such image')) {
          errorMsg = 'Required Docker images not found. Please pull images first.';
        } else if (stderrOutput.includes('Cannot connect')) {
          errorMsg = 'Cannot connect to Docker daemon. Is Docker Desktop running?';
        }
        reject(new Error(errorMsg));
      }
    });

    up.on('error', (err) => {
      clearTimeout(timeout);
      activeProcesses.delete(up);
      reject(err);
    });
  });
}

export async function stopContainers(): Promise<void> {
  const composePath = getComposePath();

  return new Promise((resolve, reject) => {
    const down = spawn(DOCKER_BIN, ['compose', '-f', composePath, 'down'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: EXTENDED_PATH }
    });

    activeProcesses.add(down);

    const timeout = setTimeout(() => {
      down.kill('SIGTERM');
      reject(new Error('Container shutdown timed out. Try force-stopping Docker containers manually.'));
    }, COMPOSE_TIMEOUT);

    down.stdout.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => emitLog(line));
    });
    down.stderr.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => emitLog(line));
    });

    down.on('close', code => {
      clearTimeout(timeout);
      activeProcesses.delete(down);
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`Docker compose down failed with code ${code}`));
      }
    });

    down.on('error', (err) => {
      clearTimeout(timeout);
      activeProcesses.delete(down);
      reject(err);
    });
  });
}

export async function waitForHealthy(
  timeoutMs = HEALTH_CHECK_TIMEOUT,
  onStatus?: (status: string) => void
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const status = await getDockerStatus();

    if (status.healthy) {
      onStatus?.('All services healthy');
      return true;
    }

    if (status.containersUp) {
      onStatus?.('Waiting for services to become healthy...');
    } else if (status.running) {
      onStatus?.('Starting containers...');
    } else {
      onStatus?.('Waiting for Docker...');
    }

    await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL));
  }

  return false;
}

export function getDockerInstallUrl(): string {
  switch (process.platform) {
    case 'darwin': return 'https://docs.docker.com/desktop/install/mac-install/';
    case 'win32': return 'https://docs.docker.com/desktop/install/windows-install/';
    default: return 'https://docs.docker.com/desktop/install/linux-install/';
  }
}

export async function checkBackendDependencies(): Promise<BackendDependencies> {
  const checkCommand = async (cmd: string): Promise<boolean> => {
    try {
      await execPromise(`"${DOCKER_BIN}" exec trh-backend which ${cmd}`);
      return true;
    } catch {
      return false;
    }
  };

  const [pnpm, node, forge, aws] = await Promise.all([
    checkCommand('pnpm'),
    checkCommand('node'),
    checkCommand('forge'),
    checkCommand('aws')
  ]);

  return { pnpm, node, forge, aws, allInstalled: pnpm && node && forge && aws };
}

export async function installBackendDependencies(onProgress?: (status: string) => void): Promise<void> {
  onProgress?.('Downloading dependency installer...');

  try {
    await execPromise(
      `"${DOCKER_BIN}" exec trh-backend bash -c "wget -q https://raw.githubusercontent.com/tokamak-network/trh-backend/refs/heads/main/docker_install_dependencies_script.sh -O /tmp/install_deps.sh && chmod +x /tmp/install_deps.sh"`
    );
  } catch {
    throw new Error('Failed to download dependency installer');
  }

  onProgress?.('Installing dependencies...');

  return new Promise((resolve, reject) => {
    const install = spawn(DOCKER_BIN, [
      'exec', 'trh-backend', 'bash', '-c',
      'DEBIAN_FRONTEND=noninteractive TZ=UTC /tmp/install_deps.sh'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: EXTENDED_PATH }
    });

    install.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        emitLog(line);
        if (line.includes('Installing') || line.includes('Setting up') || line.includes('STEP')) {
          onProgress?.(line.trim().substring(0, 50));
        }
      }
    });

    install.stderr.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => emitLog(line));
    });

    install.on('close', async (code) => {
      if (code === 0 || code === null) {
        onProgress?.('Finalizing setup...');
        try {
          await execPromise(
            `"${DOCKER_BIN}" exec trh-backend bash -c "ln -sf /root/.local/share/pnpm/pnpm /usr/local/bin/pnpm 2>/dev/null || true; ln -sf /root/.nvm/versions/node/*/bin/node /usr/local/bin/node 2>/dev/null || true; ln -sf /root/.nvm/versions/node/*/bin/npm /usr/local/bin/npm 2>/dev/null || true; ln -sf /root/.nvm/versions/node/*/bin/npx /usr/local/bin/npx 2>/dev/null || true; ln -sf /root/.foundry/bin/forge /usr/local/bin/forge 2>/dev/null || true; ln -sf /root/.foundry/bin/cast /usr/local/bin/cast 2>/dev/null || true; ln -sf /root/.foundry/bin/anvil /usr/local/bin/anvil 2>/dev/null || true"`
          );
        } catch { /* ignore symlink errors */ }
        resolve();
      } else {
        reject(new Error(`Dependency installation failed with code ${code}`));
      }
    });

    install.on('error', reject);
  });
}
