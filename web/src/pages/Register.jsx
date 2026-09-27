import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../lib/api.js';
import { useAuth, homeFor } from '../lib/auth.jsx';
import { Alert, Button, Card, Eyebrow, Field, Input, Spinner } from '../components/ui.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');

  const [role, setRole] = useState(params.get('role') === 'PROVIDER' ? 'PROVIDER' : 'CUSTOMER');
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    businessName: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const payload = {
        role,
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(role === 'PROVIDER' ? { businessName: form.businessName.trim() } : {}),
      };
      const user = await register(payload);
      navigate(next || homeFor(user), { replace: true });
    } catch (err) {
      setError(err);
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto pt-4">
      <Eyebrow className="mb-1.5">Create an account</Eyebrow>
      <h1 className="text-3xl mb-6">
        {role === 'PROVIDER' ? 'Apply to join as a provider' : 'Sign up'}
      </h1>

      {/* Role switch, stated plainly rather than hidden in a dropdown. */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        {[
          ['CUSTOMER', 'I need a service', 'Book inspections and maintenance'],
          ['PROVIDER', 'I provide services', 'Accept jobs and get paid'],
        ].map(([r, title, sub]) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`pick ${role === r ? 'pick-on' : ''}`}
            style={{ padding: '0.8rem' }}
          >
            <p className="font-semibold text-[14.5px]" style={{ fontFamily: 'var(--font-display)' }}>
              {title}
            </p>
            <p className="text-[12.5px] text-[var(--color-ink-3)] mt-0.5">{sub}</p>
          </button>
        ))}
      </div>

      <Card className="p-5" ticked>
        <form onSubmit={submit} className="grid gap-4">
          {error && <Alert tone="stop">{error.message}</Alert>}

          <Field label="Full name" required error={fieldErrors.fullName}>
            <Input value={form.fullName} onChange={set('fullName')} autoComplete="name" required />
          </Field>

          {role === 'PROVIDER' && (
            <Field
              label="Business / trading name"
              required
              error={fieldErrors.businessName}
              hint="How customers will see you."
            >
              <Input value={form.businessName} onChange={set('businessName')} required />
            </Field>
          )}

          <Field label="Email" required error={fieldErrors.email}>
            <Input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
          </Field>

          <Field
            label={role === 'PROVIDER' ? 'Mobile' : 'Mobile (optional)'}
            required={role === 'PROVIDER'}
            error={fieldErrors.phone}
            hint={
              role === 'PROVIDER'
                ? 'We text you when a job lands in your area.'
                : 'For appointment reminders and arrival alerts.'
            }
          >
            <Input
              type="tel"
              value={form.phone}
              onChange={set('phone')}
              autoComplete="tel"
              placeholder="+61 400 000 000"
              required={role === 'PROVIDER'}
            />
          </Field>

          <Field
            label="Password"
            required
            error={fieldErrors.password}
            hint="At least 10 characters, with an uppercase letter, a lowercase letter and a number."
          >
            <Input
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
              required
            />
          </Field>

          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Spinner /> : null}
            {role === 'PROVIDER' ? 'Start my application' : 'Create account'}
          </Button>

          {role === 'PROVIDER' && (
            <p className="text-[13px] text-[var(--color-ink-3)]">
              Next you&apos;ll pick your services and ZIP codes and upload your license, insurance and
              ID. Our team verifies these before you can accept work.
            </p>
          )}
        </form>
      </Card>

      <p className="text-center text-[14px] text-[var(--color-ink-2)] mt-5">
        Already have an account?{' '}
        <Link to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className="link">
          Sign in
        </Link>
      </p>
    </div>
  );
}
