"use client";
import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { CONTROL } from "./styles";

export function Field({
  label, error, hint, required, children, className, htmlFor,
}: {
  label: string; error?: string; hint?: string; required?: boolean; htmlFor?: string;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-soft">
        {label}{required && <span className="text-brand-600" aria-hidden> *</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="text-xs font-medium text-brand-700">{error}</p>}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string };

export function TextField({ label, error, hint, className, required, id, ...rest }: InputProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} required={required} htmlFor={fid} className={className}>
      <input id={fid} required={required} aria-invalid={!!error} className={cn(CONTROL, "h-10", error && "border-brand-600")} {...rest} />
    </Field>
  );
}

type PasswordProps = Omit<InputProps, "type">;

/**
 * Isian password dengan tombol tampil/sembunyi (ikon mata). Bawaan tersembunyi; tombol bertipe `button` agar tidak
 * mengirim formulir, dan label ARIA berubah menurut keadaan (sengaja memakai kata "sandi" agar pencari label "Password" tetap menemukan tepat satu elemen). Dipakai di SEMUA isian password (masuk, atur ulang, ganti, akun).
 */
export function PasswordField({ label, error, hint, className, required, id, ...rest }: PasswordProps) {
  const auto = useId();
  const fid = id ?? auto;
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} error={error} hint={hint} required={required} htmlFor={fid} className={className}>
      <div className="relative">
        <input id={fid} required={required} type={shown ? "text" : "password"} aria-invalid={!!error} className={cn(CONTROL, "h-10 pr-11", error && "border-brand-600")} {...rest} />
        <button
          type="button" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-controls={fid}
          aria-label={shown ? "Sembunyikan sandi" : "Tampilkan sandi"} title={shown ? "Sembunyikan sandi" : "Tampilkan sandi"}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
        >
          {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
    </Field>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string };

export function SelectField({ label, error, hint, className, required, id, children, ...rest }: SelectProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} required={required} htmlFor={fid} className={className}>
      <select id={fid} required={required} aria-invalid={!!error} className={cn(CONTROL, "h-10", error && "border-brand-600")} {...rest}>
        {children}
      </select>
    </Field>
  );
}

type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string };

export function TextAreaField({ label, error, hint, className, required, id, ...rest }: TextAreaProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} required={required} htmlFor={fid} className={className}>
      <textarea id={fid} required={required} aria-invalid={!!error} className={cn(CONTROL, "py-2", error && "border-brand-600")} {...rest} />
    </Field>
  );
}
