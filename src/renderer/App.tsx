import { useState, useEffect } from 'react';
import ConfigPage from './pages/ConfigPage';
import SetupPage from './pages/SetupPage';
import ReadyPage from './pages/ReadyPage';

type Page = 'config' | 'setup' | 'ready';

const api = window.electronAPI;

export default function App() {
  const [page, setPage] = useState<Page>('config');
  const [version, setVersion] = useState('1.0.0');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [credentials, setCredentials] = useState({
    email: 'admin@gmail.com',
    password: 'admin123',
  });

  useEffect(() => {
    (async () => {
      try {
        const v = await api.app.getVersion();
        setVersion(v);
      } catch {
        console.warn('Failed to get app version');
      }

      try {
        const status = await api.docker.getStatus();
        if (status.healthy) {
          setPage('ready');
          // Background update check
          api.docker.checkUpdates().then(hasUpdate => {
            if (hasUpdate) setUpdateAvailable(true);
          }).catch(() => {});
        }
      } catch {
        // Docker not available — proceed to config page
      }
    })();
  }, []);

  const handleConfigDone = (email: string, password: string) => {
    setCredentials({ email, password });
    setPage('setup');
  };

  const handleSetupDone = () => {
    setPage('ready');
  };

  return (
    <>
      {page === 'config' && <ConfigPage onContinue={handleConfigDone} />}
      {page === 'setup' && (
        <SetupPage
          adminEmail={credentials.email}
          adminPassword={credentials.password}
          onComplete={handleSetupDone}
        />
      )}
      {page === 'ready' && (
        <ReadyPage
          updateAvailable={updateAvailable}
          onUpdate={() => setUpdateAvailable(false)}
        />
      )}
      <div className="version">v{version}</div>
    </>
  );
}
