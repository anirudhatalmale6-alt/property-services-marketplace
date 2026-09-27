import { useEffect, useRef, useState } from 'react';

const cx = (...p) => p.filter(Boolean).join(' ');

/* ------------------------------------------------------------- primitives */

export function Button({ variant = 'outline', size, className, as: As = 'button', ...rest }) {
  const map = {
    primary: 'btn-primary',
    ink: 'btn-ink',
    outline: 'btn-outline',
    quiet: 'btn-quiet',
    danger: 'btn-danger',
  };
  return <As className={cx('btn', map[variant], size === 'sm' && 'btn-sm', className)} {...rest} />;
}

export function Badge({ tone = 'badge-mute', children, className }) {
  return <span className={cx('badge', tone, className)}>{children}</span>;
}

export function Alert({ tone = 'info', title, children, className }) {
  const map = { info: 'alert-info', go: 'alert-go', stop: 'alert-stop', hold: 'alert-hold' };
  return (
    <div className={cx('alert', map[tone], className)} role={tone === 'stop' ? 'alert' : undefined}>
      {title && <p className="font-semibold mb-0.5">{title}</p>}
      {children}
    </div>
  );
}

export function Card({ children, className, ticked = false }) {
  return <div className={cx('surface', ticked && 'ticked', className)}>{children}</div>;
}

export function Eyebrow({ children, className }) {
  return <p className={cx('eyebrow', className)}>{children}</p>;
}

/** Page heading block with an optional right-hand action area. */
export function PageHead({ eyebrow, title, sub, actions, className }) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-4 mb-6', className)}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow>}
        <h1 className="text-2xl sm:text-3xl">{title}</h1>
        {sub && <p className="text-[var(--color-ink-2)] mt-1.5 max-w-2xl">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

export function Field({ label, error, hint, children, className, required }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">
        {label}
        {required && <span className="text-[var(--color-hivis)] ml-1">*</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-[13px] text-[var(--color-ink-3)] mt-1">{hint}</span>}
      {error && <span className="field-error block">{error}</span>}
    </label>
  );
}

export function Input({ error, className, ...rest }) {
  return <input className={cx('input', className)} aria-invalid={error ? 'true' : undefined} {...rest} />;
}

export function Textarea({ error, className, ...rest }) {
  return (
    <textarea className={cx('textarea', className)} aria-invalid={error ? 'true' : undefined} {...rest} />
  );
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cx('select', className)} {...rest}>
      {children}
    </select>
  );
}

/* ----------------------------------------------------------------- states */

export function Spinner({ className }) {
  return (
    <span
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', className)}
      style={{ width: '1em', height: '1em' }}
      aria-hidden="true"
    />
  );
}

export function Loading({ label = 'Loading', className }) {
  return (
    <div className={cx('flex items-center gap-2.5 text-[var(--color-ink-3)] py-12 justify-center', className)}>
      <Spinner />
      <span className="eyebrow">{label}</span>
    </div>
  );
}

export function Empty({ title, children, action, className }) {
  return (
    <div className={cx('text-center py-14 px-6', className)}>
      <div
        className="mx-auto mb-4 grid place-items-center"
        style={{
          width: 44,
          height: 44,
          border: '1.5px dashed var(--color-rule-strong)',
          borderRadius: 2,
        }}
        aria-hidden="true"
      >
        <span className="ref text-[var(--color-ink-3)] text-lg">—</span>
      </div>
      <h3 className="text-lg mb-1">{title}</h3>
      {children && <p className="text-[var(--color-ink-2)] max-w-md mx-auto">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Error surface for a failed load, with a retry that the caller supplies. */
export function ErrorState({ error, onRetry, className }) {
  return (
    <Alert tone="stop" className={cx('my-6', className)} title="That didn't load">
      <p>{error?.message || 'Something went wrong.'}</p>
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-2.5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Alert>
  );
}

/* ---------------------------------------------------------------- stepper */

export function Stepper({ steps, current }) {
  return (
    <ol className="flex items-center gap-0 mb-8 overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex items-center flex-none">
            <div className="flex items-center gap-2.5 px-1">
              <span
                className={cx('step-dot', active && 'step-dot-active', done && 'step-dot-done')}
                aria-current={active ? 'step' : undefined}
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                className={cx(
                  'text-[13px] font-semibold whitespace-nowrap',
                  active ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-3)]',
                )}
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {s}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                className="block mx-2"
                style={{
                  width: 26,
                  height: 1,
                  background: done ? 'var(--color-go)' : 'var(--color-rule-strong)',
                }}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------- data presentation */

/** Label/value row, the workhorse of every detail panel. */
export function Row({ label, children, className, mono = false }) {
  return (
    <div className={cx('flex justify-between gap-4 py-2', className)}>
      <span className="label mb-0 pt-0.5 flex-none">{label}</span>
      <span className={cx('text-right min-w-0 break-words', mono && 'ref')}>{children}</span>
    </div>
  );
}

/** Big headline number for a dashboard tile. */
export function Stat({ label, value, sub, tone, href, onClick }) {
  const Wrap = href || onClick ? 'button' : 'div';
  return (
    <Wrap
      onClick={onClick}
      className={cx(
        'surface p-4 text-left w-full',
        (href || onClick) && 'hover:border-[var(--color-ink-3)] cursor-pointer transition-colors',
      )}
      style={tone ? { borderLeft: `3px solid ${tone}` } : undefined}
    >
      <p className="eyebrow mb-2">{label}</p>
      <p className="text-2xl sm:text-[28px] leading-none tnum" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
        {value}
      </p>
      {sub && <p className="text-[13px] text-[var(--color-ink-3)] mt-1.5">{sub}</p>}
    </Wrap>
  );
}

/** Vertical audit trail. */
export function Timeline({ items }) {
  if (!items?.length) return null;
  return (
    <ol className="relative pl-5">
      <span
        className="absolute left-[3px] top-1.5 bottom-1.5 w-px"
        style={{ background: 'var(--color-rule-strong)' }}
        aria-hidden="true"
      />
      {items.map((it, i) => (
        <li key={i} className="relative pb-4 last:pb-0">
          <span
            className="absolute rounded-full"
            style={{
              left: -17,
              top: 6,
              width: 7,
              height: 7,
              background: i === items.length - 1 ? 'var(--color-hivis)' : 'var(--color-rule-strong)',
            }}
            aria-hidden="true"
          />
          <p className="font-semibold text-[14.5px]">{it.title}</p>
          {it.note && <p className="text-[13.5px] text-[var(--color-ink-2)]">{it.note}</p>}
          <p className="ref text-[11.5px] text-[var(--color-ink-3)] mt-0.5">{it.at}</p>
        </li>
      ))}
    </ol>
  );
}

/* ----------------------------------------------------------------- modal */

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    // Stop the page behind from scrolling while a dialog is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(20,26,31,.55)' }}
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={cx('surface w-full rise outline-none max-h-[92vh] overflow-y-auto', width)}
      >
        <div className="flex items-start justify-between gap-4 p-4 border-b">
          <h2 className="text-lg">{title}</h2>
          <button className="btn btn-quiet flex-none" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="p-4 border-t flex justify-end gap-2 flex-wrap">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirm-then-act, so a destructive click is never a single tap. */
export function ConfirmButton({
  children,
  onConfirm,
  title = 'Are you sure?',
  body,
  confirmLabel = 'Confirm',
  needsReason = false,
  reasonLabel = 'Reason',
  variant = 'danger',
  size,
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(reason);
      setOpen(false);
      setReason('');
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={title}
        footer={
          <>
            <Button variant="quiet" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              onClick={go}
              disabled={busy || (needsReason && reason.trim().length < 3)}
            >
              {busy ? <Spinner /> : null}
              {confirmLabel}
            </Button>
          </>
        }
      >
        {body && <p className="mb-3">{body}</p>}
        {needsReason && (
          <Field label={reasonLabel} required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {err && <Alert tone="stop" className="mt-3">{err.message}</Alert>}
      </Modal>
    </>
  );
}
