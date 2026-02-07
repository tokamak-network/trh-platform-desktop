import { useState } from 'react';
import './ConfigPage.css';
import nextIcon from '../assets/icon/next-icon.svg';

interface ConfigPageProps {
  onContinue: (email: string, password: string) => void;
}

export default function ConfigPage({ onContinue }: ConfigPageProps) {
  const [configType, setConfigType] = useState<'default' | 'custom'>('default');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const selectOption = (type: 'default' | 'custom') => {
    setConfigType(type);
  };

  const handleContinue = () => {
    if (configType === 'custom') {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert('Please enter a valid email address');
        return;
      }
      if (!password || password.length < 8) {
        alert('Password must be at least 8 characters');
        return;
      }
      onContinue(email, password);
    } else {
      onContinue('admin@gmail.com', 'admin123');
    }
  };

  return (
    <div className="config-page">
      <div className="config-container">
        <div className="config-header">
          <h1>Platform Configuration</h1>
          <p>Set up your admin credentials for the platform</p>
        </div>

        <div className="config-card">
          <div
            className={`config-option ${configType === 'default' ? 'selected' : ''}`}
            onClick={() => selectOption('default')}
          >
            <input
              type="radio"
              name="config-type"
              checked={configType === 'default'}
              onChange={() => selectOption('default')}
            />
            <div className="config-option-content">
              <div className="config-option-title">Use Default Credentials</div>
              <div className="config-option-desc">Quick setup with pre-configured admin account</div>
              <div className="credentials-display">
                <p>Email: <code>admin@gmail.com</code></p>
                <p>Password: <code>admin123</code></p>
              </div>
            </div>
          </div>

          <div
            className={`config-option ${configType === 'custom' ? 'selected' : ''}`}
            onClick={() => selectOption('custom')}
          >
            <input
              type="radio"
              name="config-type"
              checked={configType === 'custom'}
              onChange={() => selectOption('custom')}
            />
            <div className="config-option-content">
              <div className="config-option-title">Set Custom Credentials</div>
              <div className="config-option-desc">Configure your own admin email and password</div>
            </div>
          </div>

          {configType === 'custom' && (
            <div className="config-fields visible">
              <div className="form-group">
                <label htmlFor="admin-email">Admin Email</label>
                <input
                  type="email"
                  id="admin-email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <div className="hint">Must be a valid email format</div>
              </div>
              <div className="form-group">
                <label htmlFor="admin-password">Admin Password</label>
                <input
                  type="password"
                  id="admin-password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <div className="hint">Minimum 8 characters</div>
              </div>
            </div>
          )}

          <div className="config-actions">
            <button className="btn-continue" onClick={handleContinue}>
              Continue
              <img src={nextIcon} alt="arrow" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
