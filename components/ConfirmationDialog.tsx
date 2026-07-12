import React from 'react';
import { createPortal } from 'react-dom';

interface ConfirmationDialogProps {
    open: boolean;
    title: string;
    description: string;
    hint?: string;
    cancelLabel: string;
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
    open,
    title,
    description,
    hint,
    cancelLabel,
    confirmLabel,
    onCancel,
    onConfirm,
}) => {
    const dialogRef = React.useRef<HTMLElement>(null);
    const cancelButtonRef = React.useRef<HTMLButtonElement>(null);

    React.useEffect(() => {
        if (!open) return;

        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const focusFrame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
                return;
            }

            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusable = Array.from(
                dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')
            ) as HTMLElement[];
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
            previouslyFocused?.focus();
        };
    }, [onCancel, open]);

    if (!open) return null;

    return createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center px-4 py-6">
            <div
                className="animate-scrim-in absolute inset-0 bg-black/30"
                aria-hidden="true"
                onMouseDown={onCancel}
            />
            <section
                ref={dialogRef}
                className="md3-dialog animate-dialog-in relative max-h-[calc(100vh-48px)] w-full max-w-[420px] overflow-y-auto rounded-[28px] bg-surface-container-high p-6"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirmation-dialog-title"
                aria-describedby="confirmation-dialog-description"
                data-testid="confirmation-dialog"
            >
                <h2 id="confirmation-dialog-title" className="text-2xl font-medium leading-8 text-on-surface">
                    {title}
                </h2>
                <p id="confirmation-dialog-description" className="mt-4 text-sm leading-5 text-on-surface-variant">
                    {description}
                </p>
                {hint && (
                    <p className="mt-2 text-sm leading-5 text-primary">
                        {hint}
                    </p>
                )}

                <div className="mt-6 flex items-center justify-end gap-2">
                    <button
                        ref={cancelButtonRef}
                        type="button"
                        onClick={onCancel}
                        className="focus-apple min-h-10 rounded-full px-3 text-sm font-medium text-primary transition-colors hover:bg-primary-fixed/60"
                        data-testid="confirmation-cancel"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="focus-apple min-h-10 rounded-full px-3 text-sm font-medium text-error transition-colors hover:bg-error-container"
                        data-testid="confirmation-confirm"
                    >
                        {confirmLabel}
                    </button>
                </div>
            </section>
        </div>,
        document.body
    );
};
