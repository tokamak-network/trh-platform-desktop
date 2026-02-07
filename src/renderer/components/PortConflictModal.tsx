import type { PortConflict } from '../types';
import './PortConflictModal.css';

interface PortConflictModalProps {
  conflicts: PortConflict[];
  onConfirm: () => void;
  onCancel: () => void;
}

export default function PortConflictModal({ conflicts, onConfirm, onCancel }: PortConflictModalProps) {
  return (
    <div className="modal-overlay visible">
      <div className="modal">
        <div className="modal-icon">&#x26A0;</div>
        <h3>Port Conflict Detected</h3>
        <p>
          The following ports are in use by other processes. These ports are
          required to run the platform.
        </p>
        <ul className="conflict-list">
          {conflicts.map((c, i) => (
            <li key={i} className="conflict-item">
              <span className="conflict-port">Port {c.port}</span>
              <span className="conflict-process">
                {c.processName} (PID {c.pid})
              </span>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button className="btn-modal btn-modal-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-modal btn-modal-confirm" onClick={onConfirm}>
            Free Ports &amp; Continue
          </button>
        </div>
      </div>
    </div>
  );
}
