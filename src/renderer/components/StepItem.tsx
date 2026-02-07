import './StepItem.css';

export type StepStatus = 'pending' | 'loading' | 'success' | 'error';

interface StepItemProps {
  index: number;
  title: string;
  detail: string;
  status: StepStatus;
  progress?: number;
  showProgress?: boolean;
}

export default function StepItem({ index, title, detail, status, progress, showProgress }: StepItemProps) {
  return (
    <div className={`step ${status}`}>
      <div className="indicator">
        {status === 'success' ? (
          <svg className="check" viewBox="0 0 24 24">
            <path d="M5 12l5 5L20 7" />
          </svg>
        ) : status === 'error' ? (
          <span>!</span>
        ) : (
          <span>{index}</span>
        )}
      </div>
      <div className="step-content">
        <div className="step-title">{title}</div>
        <div className="step-desc">{detail}</div>
        {showProgress && (
          <div className={`progress-bar ${status === 'loading' ? 'active' : ''}`}>
            <div className="progress-fill" style={{ width: `${progress ?? 0}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
