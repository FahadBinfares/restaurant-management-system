import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react";
import { errorMessage } from "../lib/errors";
import type { Tone } from "../lib/labels";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-secondary text-white hover:bg-secondary/90",
  secondary: "bg-white text-Text border border-Text/30 hover:bg-main",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "text-Text hover:bg-secondary/10",
};

export function Button({
  variant = "primary", loading, className, children, disabled, ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_VARIANTS[variant], className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

const fieldClass = "w-full rounded-lg border border-Text/25 bg-white px-3 py-2 text-sm text-gray-900 "
  + "focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20 disabled:bg-gray-100";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(fieldClass, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(fieldClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(fieldClass, "min-h-20", className)} {...props} />;
}

/** Label + control + error. Pass a render function to receive the generated id. */
export function Field({ label, error, hint, children, className }: {
  label: string; error?: string; hint?: string; className?: string; children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-medium text-Text">{label}</label>
      {children(id)}
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}

const TONES: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-800",
  info: "bg-blue-100 text-blue-800",
  warning: "bg-Light-yellow text-amber-900",
  success: "bg-Light-green text-green-800",
  danger: "bg-Light-red text-red-800",
  muted: "bg-gray-200 text-gray-600",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", TONES[tone])}>{children}</span>;
}

export function Card({ title, actions, children, className }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-Text/10 bg-surface p-4 shadow-sm", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold text-Text">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold text-Text">{title}</h1>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      className={cx("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", small ? "size-4" : "size-6")}
      role="status"
      aria-label="جارٍ التحميل"
    />
  );
}

export function Loading() {
  return <div className="flex justify-center py-12 text-secondary"><Spinner /></div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-Text/25 py-12 text-center">
      <p className="text-lg font-medium text-Text">{title}</p>
      {children && <div className="text-sm text-gray-600">{children}</div>}
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-lg bg-Light-red px-4 py-3 text-sm text-red-800" role="alert">{errorMessage(error)}</div>;
}

/** Accessible dialog based on the native <dialog> element. */
export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      open
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className={cx("fixed inset-0 z-50 m-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl bg-white p-0 shadow-2xl backdrop:bg-black/40",
        wide ? "max-w-3xl" : "max-w-lg")}
      aria-label={title}
    >
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="text-lg font-semibold text-Text">{title}</h2>
        <button type="button" onClick={onClose} className="rounded p-1 text-xl leading-none text-gray-500 hover:bg-gray-100" aria-label="إغلاق">×</button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}

/** Side drawer from the start edge (right in RTL). */
export function Drawer({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl" role="dialog" aria-modal="true">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="text-lg font-semibold text-Text">{title}</div>
          <button type="button" onClick={onClose} className="rounded p-1 text-xl leading-none text-gray-500 hover:bg-gray-100" aria-label="إغلاق">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
      <button type="button" className="flex-1 bg-black/30" onClick={onClose} aria-label="إغلاق" tabIndex={-1} />
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: { id: T; label: string }[]; active: T; onChange: (id: T) => void;
}) {
  return (
    <div className="mb-4 flex gap-1 border-b" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          onClick={() => onChange(tab.id)}
          className={cx("-mb-px border-b-2 px-4 py-2 text-sm font-medium",
            tab.id === active ? "border-secondary text-secondary" : "border-transparent text-gray-600 hover:text-Text")}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Simple confirmation dialog with an optional required reason. */
export function ConfirmDialog({ open, title, message, confirmLabel, danger, requireReason, loading, error, onConfirm, onClose }: {
  open: boolean; title: string; message?: ReactNode; confirmLabel: string; danger?: boolean; requireReason?: boolean;
  loading?: boolean; error?: unknown; onConfirm: (reason: string) => void; onClose: () => void;
}) {
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(reasonRef.current?.value.trim() ?? "");
        }}
      >
        {message && <div className="text-sm text-gray-700">{message}</div>}
        {requireReason && (
          <Field label="السبب">{(id) => <Textarea id={id} ref={reasonRef} required minLength={3} maxLength={500} />}</Field>
        )}
        <ErrorMessage error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>تراجع</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={loading}>{confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-Text/10 bg-white">
      <table className="w-full text-right text-sm">{children}</table>
    </div>
  );
}

export const th = "border-b bg-main/60 px-3 py-2 font-semibold text-Text whitespace-nowrap";
export const td = "border-b px-3 py-2 align-top";
