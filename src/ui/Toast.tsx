import { useEffect } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

/// The phone's toast: an inverted ink pill at the bottom, with an optional
/// action such as Undo. It leaves on its own after a few seconds.
export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDone, toast.action ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [toast, onDone]);

  return (
    <div className="toast-slot" role="status" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action!.run();
                onDone();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
