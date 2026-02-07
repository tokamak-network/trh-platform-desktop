import { useState, useRef, useEffect, useCallback } from 'react';
import './TerminalPanel.css';

export interface LogLine {
  text: string;
  timestamp: string;
  type: 'default' | 'error' | 'success' | 'info';
}

function classifyLog(line: string): LogLine['type'] {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('fail') || lower.includes('cannot')) return 'error';
  if (lower.includes('success') || lower.includes('healthy') || lower.includes('done') || lower.includes('ready')) return 'success';
  if (lower.includes('pulling') || lower.includes('downloading') || lower.includes('installing') || lower.includes('starting')) return 'info';
  return 'default';
}

function getTimestamp(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface TerminalPanelProps {
  logs: LogLine[];
  onClear: () => void;
}

export function createLogLine(text: string): LogLine {
  return { text, timestamp: getTimestamp(), type: classifyLog(text) };
}

export default function TerminalPanel({ logs, onClear }: TerminalPanelProps) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="terminal-section">
      <div className="terminal-toggle" onClick={() => setOpen(!open)}>
        <svg
          className={`terminal-toggle-icon ${open ? 'open' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="terminal-toggle-label">Logs</span>
        <span className="terminal-badge">
          {logs.length} {logs.length === 1 ? 'line' : 'lines'}
        </span>
      </div>
      {open && (
        <div className="terminal-container">
          <div className="terminal-header">
            <div className="terminal-dot red" />
            <div className="terminal-dot yellow" />
            <div className="terminal-dot green" />
            <span className="terminal-title">setup — docker</span>
            <button className="terminal-clear" onClick={onClear}>Clear</button>
          </div>
          <div className="terminal-body" ref={bodyRef}>
            {logs.length === 0 ? (
              <div className="log-empty">Waiting for logs...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`log-line ${log.type}`}>
                  <span className="timestamp">{log.timestamp}</span>
                  {log.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
