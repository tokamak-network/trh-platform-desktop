import { useState, useEffect, useRef, useCallback } from 'react';
import StepItem, { type StepStatus } from '../components/StepItem';
import TerminalPanel, { type LogLine, createLogLine } from '../components/TerminalPanel';
import PortConflictModal from '../components/PortConflictModal';
import type { PortConflict } from '../types';
import './SetupPage.css';
import logo from '../assets/logo/logo.svg';
import tokamakLogo from '../assets/logo/tokamak.svg';
import rollupHubLogo from '../assets/logo/rolluphub.svg';

const api = window.electronAPI;

interface SetupPageProps {
  adminEmail: string;
  adminPassword: string;
  onComplete: () => void;
}

interface StepState {
  status: StepStatus;
  detail: string;
  progress?: number;
}

type PortModalState =
  | { open: false }
  | { open: true; conflicts: PortConflict[]; resolve: (action: 'confirm' | 'cancel') => void };

export default function SetupPage({ adminEmail, adminPassword, onComplete }: SetupPageProps) {
  const [steps, setSteps] = useState<Record<string, StepState>>({
    docker: { status: 'pending', detail: 'Waiting...' },
    images: { status: 'pending', detail: 'Waiting...' },
    containers: { status: 'pending', detail: 'Waiting...' },
    deps: { status: 'pending', detail: 'Waiting...' },
    ready: { status: 'pending', detail: 'Waiting...' },
  });
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [showRetry, setShowRetry] = useState(false);
  const [showInstallDocker, setShowInstallDocker] = useState(false);
  const [portModal, setPortModal] = useState<PortModalState>({ open: false });
  const runningRef = useRef(false);

  const appendLog = useCallback((text: string) => {
    setLogs(prev => [...prev, createLogLine(text)]);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const updateStep = useCallback((key: string, update: Partial<StepState>) => {
    setSteps(prev => ({ ...prev, [key]: { ...prev[key], ...update } }));
  }, []);

  const truncate = (s: string, max = 35) => s.length > max ? s.substring(0, max) + '...' : s;

  const runSetup = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setError(null);
    setShowRetry(false);
    setShowInstallDocker(false);

    // Reset all steps
    setSteps({
      docker: { status: 'pending', detail: 'Waiting...' },
      images: { status: 'pending', detail: 'Waiting...' },
      containers: { status: 'pending', detail: 'Waiting...' },
      deps: { status: 'pending', detail: 'Waiting...' },
      ready: { status: 'pending', detail: 'Waiting...' },
    });

    api.docker.removeAllListeners();
    const logCleanup = api.docker.onLog((line) => {
      setLogs(prev => [...prev, createLogLine(line)]);
    });

    appendLog('Starting setup...');

    // Step 1: Docker check
    appendLog('Checking Docker installation...');
    updateStep('docker', { status: 'loading', detail: 'Checking Docker...' });

    const installed = await api.docker.checkInstalled();
    if (!installed) {
      appendLog('Docker not found on system');
      updateStep('docker', { status: 'error', detail: 'Not installed' });
      setError({ title: 'Docker Required', message: 'Install Docker Desktop to continue.' });
      setShowInstallDocker(true);
      setShowRetry(true);
      runningRef.current = false;
      logCleanup();
      return;
    }

    appendLog('Docker installed, checking if daemon is running...');
    const running = await api.docker.checkRunning();
    if (!running) {
      appendLog('Docker daemon is not running');
      updateStep('docker', { status: 'error', detail: 'Not running' });
      setError({ title: 'Docker Not Running', message: 'Start Docker Desktop and retry.' });
      setShowRetry(true);
      runningRef.current = false;
      logCleanup();
      return;
    }

    appendLog('Docker daemon is running');
    updateStep('docker', { status: 'success', detail: 'Docker ready' });

    // Step 2: Pull images
    appendLog('Pulling container images...');
    updateStep('images', { status: 'loading', detail: 'Pulling images...', progress: 0 });

    let pullProgress = 0;
    const pullCleanup = api.docker.onPullProgress((progress) => {
      pullProgress = Math.min(pullProgress + 2, 95);
      updateStep('images', {
        status: 'loading',
        detail: truncate(progress.status),
        progress: pullProgress,
      });
    });

    try {
      await api.docker.pullImages();
      appendLog('All images pulled successfully');
      updateStep('images', { status: 'success', detail: 'Images ready', progress: 100 });
    } catch (err: any) {
      updateStep('images', { status: 'error', detail: 'Failed' });
      setError({ title: 'Pull Failed', message: err.message || 'Check internet connection.' });
      setShowRetry(true);
      runningRef.current = false;
      pullCleanup();
      logCleanup();
      return;
    } finally {
      pullCleanup();
    }

    // Step 3: Port check + Start containers
    // Helper: check ports, show modal if conflicts, kill if user confirms
    const resolvePortConflicts = async (): Promise<boolean> => {
      appendLog('Checking for port conflicts...');
      updateStep('containers', { status: 'loading', detail: 'Checking ports...' });

      const portResult = await api.docker.checkPorts();
      if (portResult.available) {
        appendLog('All ports available');
        return true;
      }

      const conflictPorts = [...new Set(portResult.conflicts.map(c => c.port))];
      appendLog('Port conflict on: ' + conflictPorts.join(', '));

      const userChoice = await new Promise<'confirm' | 'cancel'>((resolve) => {
        setPortModal({ open: true, conflicts: portResult.conflicts, resolve });
      });
      setPortModal({ open: false });

      if (userChoice === 'cancel') {
        appendLog('User cancelled — ports not freed');
        return false;
      }

      appendLog('Freeing ports...');
      updateStep('containers', { status: 'loading', detail: 'Freeing ports...' });
      await api.docker.killPortProcesses(conflictPorts);
      appendLog('Ports freed successfully');
      return true;
    };

    const isPortError = (msg: string) =>
      msg.toLowerCase().includes('port') || msg.toLowerCase().includes('address already in use');

    // Attempt container start with port conflict resolution (up to 3 tries)
    let containerStarted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const portsOk = await resolvePortConflicts();
        if (!portsOk) {
          updateStep('containers', { status: 'error', detail: 'Port conflict' });
          setError({ title: 'Port Conflict', message: 'Free the required ports manually and retry.' });
          setShowRetry(true);
          runningRef.current = false;
          logCleanup();
          return;
        }

        appendLog('Starting containers with docker compose...');
        updateStep('containers', { status: 'loading', detail: 'Starting...' });
        await api.docker.start({ adminEmail, adminPassword });
        appendLog('Containers started successfully');
        updateStep('containers', { status: 'success', detail: 'Running' });
        containerStarted = true;
        break;
      } catch (err: any) {
        const errorMsg = err.message || 'Could not start containers.';
        if (isPortError(errorMsg) && attempt < 2) {
          appendLog('Port conflict during startup, retrying...');
          continue;
        }
        updateStep('containers', { status: 'error', detail: 'Failed' });
        setError({ title: 'Start Failed', message: errorMsg });
        setShowRetry(true);
        runningRef.current = false;
        logCleanup();
        return;
      }
    }

    if (!containerStarted) {
      updateStep('containers', { status: 'error', detail: 'Failed' });
      setError({ title: 'Start Failed', message: 'Could not start containers after multiple attempts.' });
      setShowRetry(true);
      runningRef.current = false;
      logCleanup();
      return;
    }

    // Step 4: Backend dependencies
    appendLog('Checking backend dependencies...');
    updateStep('deps', { status: 'loading', detail: 'Checking dependencies...', progress: 10 });

    try {
      await new Promise(r => setTimeout(r, 2000));
      const deps = await api.docker.checkBackendDeps();
      updateStep('deps', { progress: 30 });

      if (!deps.allInstalled) {
        const missing: string[] = [];
        if (!deps.pnpm) missing.push('pnpm');
        if (!deps.node) missing.push('node');
        if (!deps.forge) missing.push('forge');
        if (!deps.aws) missing.push('aws');

        appendLog('Installing: ' + missing.join(', '));
        updateStep('deps', { status: 'loading', detail: `Installing: ${missing.join(', ')}...` });

        const installCleanup = api.docker.onInstallProgress((status) => {
          updateStep('deps', { status: 'loading', detail: truncate(status) });
        });

        await api.docker.installBackendDeps();
        installCleanup();

        updateStep('deps', { status: 'loading', detail: 'Verifying installation...', progress: 90 });
        await new Promise(r => setTimeout(r, 1000));

        const verifyDeps = await api.docker.checkBackendDeps();
        if (!verifyDeps.allInstalled) {
          const stillMissing: string[] = [];
          if (!verifyDeps.pnpm) stillMissing.push('pnpm');
          if (!verifyDeps.node) stillMissing.push('node');
          if (!verifyDeps.forge) stillMissing.push('forge');
          if (!verifyDeps.aws) stillMissing.push('aws');
          throw new Error(`Still missing: ${stillMissing.join(', ')}`);
        }
      }

      appendLog('All backend dependencies verified');
      updateStep('deps', { status: 'success', detail: 'All tools ready', progress: 100 });
    } catch (err: any) {
      updateStep('deps', { status: 'error', detail: 'Installation failed' });
      setError({ title: 'Dependencies Failed', message: err.message || 'Could not install backend tools.' });
      setShowRetry(true);
      runningRef.current = false;
      logCleanup();
      return;
    }

    // Step 5: Health check
    appendLog('Running health checks...');
    updateStep('ready', { status: 'loading', detail: 'Health check...' });

    const statusCleanup = api.docker.onStatusUpdate((status) => {
      updateStep('ready', { status: 'loading', detail: status });
    });

    try {
      const healthy = await api.docker.waitHealthy(180000);
      statusCleanup();

      if (!healthy) {
        updateStep('ready', { status: 'error', detail: 'Timeout' });
        setError({ title: 'Timeout', message: 'Services did not become healthy in time.' });
        setShowRetry(true);
        runningRef.current = false;
        logCleanup();
        return;
      }

      appendLog('All services healthy - setup complete!');
      updateStep('ready', { status: 'success', detail: 'All systems go!' });
      runningRef.current = false;
      logCleanup();

      await new Promise(r => setTimeout(r, 600));
      onComplete();
    } catch (err: any) {
      statusCleanup();
      updateStep('ready', { status: 'error', detail: 'Error' });
      setError({ title: 'Failed', message: err.message || 'Unexpected error.' });
      setShowRetry(true);
      runningRef.current = false;
      logCleanup();
    }
  }, [adminEmail, adminPassword, appendLog, updateStep, onComplete]);

  useEffect(() => {
    runSetup();
    return () => {
      api.docker.removeAllListeners();
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (runningRef.current) {
        e.preventDefault();
        e.returnValue = 'Setup is in progress. Closing may leave the system in an inconsistent state.';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handleRetry = () => {
    runSetup();
  };

  const handleInstallDocker = async () => {
    try {
      const url = await api.docker.getInstallUrl();
      await api.app.openExternal(url);
    } catch {
      setError({ title: 'Error', message: 'Could not open Docker install page.' });
    }
  };

  return (
    <div className="setup-page">
      <div className="container">
        <div className="header">
          <div className="logo-row">
            <img src={logo} alt="TRH" className="logo-main" />
            <div className="logo-words">
              <img src={tokamakLogo} alt="Tokamak" />
              <div className="logo-sep" />
              <img src={rollupHubLogo} alt="Rollup Hub" />
            </div>
          </div>
          <h1>TRH Desktop</h1>
          <p className="subtitle">One-click L2 Rollup Deployment</p>
        </div>

        <div className="steps">
          <StepItem index={1} title="Docker Environment" detail={steps.docker.detail} status={steps.docker.status} />
          <StepItem index={2} title="Container Images" detail={steps.images.detail} status={steps.images.status} showProgress progress={steps.images.progress} />
          <StepItem index={3} title="Starting Services" detail={steps.containers.detail} status={steps.containers.status} />
          <StepItem index={4} title="Backend Dependencies" detail={steps.deps.detail} status={steps.deps.status} showProgress progress={steps.deps.progress} />
          <StepItem index={5} title="Platform Ready" detail={steps.ready.detail} status={steps.ready.status} />
        </div>

        {error && (
          <div className="error-box visible">
            <h4>{error.title}</h4>
            <p>{error.message}</p>
          </div>
        )}

        <TerminalPanel logs={logs} onClear={clearLogs} />

        <div className="btn-row">
          {showInstallDocker && (
            <button className="btn btn-primary" onClick={handleInstallDocker}>
              Install Docker
            </button>
          )}
          {showRetry && (
            <button className="btn btn-outline" onClick={handleRetry}>
              Retry
            </button>
          )}
        </div>
      </div>

      {portModal.open && (
        <PortConflictModal
          conflicts={portModal.conflicts}
          onConfirm={() => portModal.resolve('confirm')}
          onCancel={() => portModal.resolve('cancel')}
        />
      )}
    </div>
  );
}
