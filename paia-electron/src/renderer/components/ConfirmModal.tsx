// Reusable confirmation modal — replaces browser `confirm()` calls
// with a properly styled, focus-trapped, keyboard-friendly dialog.
//
// Used everywhere the user is about to take a destructive action:
// delete persona, remove license, regenerate API key, etc.
//
// Keyboard:
//   Enter → confirm (when the primary button has focus, which it does
//                    by default for non-destructive actions)
//   Esc   → cancel (always)
//
// For destructive actions (deleteVariant = 'danger'), the Cancel button
// is auto-focused instead — defensive default that costs nothing.

import { useEffect, useRef } from 'react';
import { useFocusTrap } from '../lib/focusTrap';

export interface ConfirmModalProps {
  title: string;
  /** Body text. Can include details about what the action affects. */
  description?: string;
  /** Primary action label. Default: "Confirm". */
  confirmLabel?: string;
  /** Cancel button label. Default: "Cancel". */
  cancelLabel?: string;
  /** Styles the primary button: 'danger' = destructive (red) and
   *  focuses Cancel by default; 'primary' = normal (accent) and
   *  focuses Confirm by default. */
  variant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal(props: ConfirmModalProps) {
  const {
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'primary',
    onConfirm,
    onCancel,
  } = props;

  const ref = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useFocusTrap(ref, { onClose: onCancel });

  useEffect(() => {
    // Defensive default: dangerous actions focus Cancel so a stray
    // Enter doesn't fire the destructive path.
    if (variant === 'danger') cancelRef.current?.focus();
    else confirmRef.current?.focus();
  }, [variant]);

  return (
    <div className="confirm-backdrop" onClick={onCancel}>
      <div
        ref={ref}
        className="confirm-modal"
        role="alertdialog"
        aria-labelledby="confirm-modal-title"
        aria-describedby={description ? 'confirm-modal-body' : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-modal-title" className="confirm-title">{title}</h3>
        {description && (
          <p id="confirm-modal-body" className="confirm-body">{description}</p>
        )}
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={variant === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
