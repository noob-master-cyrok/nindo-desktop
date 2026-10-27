import { useEffect, useRef, type ReactNode } from 'react';

/// A native modal dialog: focus is trapped and Escape closes it.
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

export function Confirm({
  title,
  body,
  action,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  action: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {body}
        <div className="row end">
          <button onClick={onClose} autoFocus>
            Cancel
          </button>
          <button className={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {action}
          </button>
        </div>
      </div>
    </Modal>
  );
}
