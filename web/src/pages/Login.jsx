import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, homeFor } from '../lib/auth.jsx';
import { Alert, Button, Card, Eyebrow, Field, Input, Spinner } from '../components/ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email.trim(), password);
      navigate(next || homeFor(user), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto pt-4">
      <Eyebrow className="mb-1.5">Welcome back</Eyebrow>
      <h1 className="text-3xl mb-6">Sign in</h1>

      <Card className="p-5" ticked>
        <form onSubmit={submit} className="grid gap-4">
          {error && <Alert tone="stop">{error.message}</Alert>}

          <Field label="Email" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
            />
          </Field>

          <Field label="Password" required>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          <Button type="submit" variant="primary" disabled={busy || !email || !password}>
            {busy ? <Spinner /> : null}
            Sign in
          </Button>
        </form>
      </Card>

      <p className="text-center text-[14px] text-[var(--color-ink-2)] mt-5">
        No account yet?{' '}
        <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'} className="link">
          Create one
        </Link>
      </p>

      {/*
        Demo credentials, visible because this is a review build. Delete this
        block before the platform takes a real customer.
      */}
      <Card className="p-4 mt-7">
        <Eyebrow className="mb-2.5">Demo accounts — review build only</Eyebrow>
        <div className="space-y-1.5 text-[13px]">
          {[
            ['customer@example.com', 'Customer with bookings in flight'],
            ['provider@example.com', 'Approved provider — inspections'],
            ['provider2@example.com', 'Approved provider — maintenance'],
            ['provider3@example.com', 'Provider awaiting approval'],
            ['admin@example.com', 'Admin dashboard'],
          ].map(([em, what]) => (
            <button
              key={em}
              type="button"
              onClick={() => {
                setEmail(em);
                setPassword('DemoPass123!');
              }}
              className="flex w-full items-baseline justify-between gap-3 text-left hover:bg-[var(--color-paper-2)] px-1.5 py-1 -mx-1.5 rounded"
            >
              <span className="ref text-[12px]">{em}</span>
              <span className="text-[var(--color-ink-3)] text-right">{what}</span>
            </button>
          ))}
        </div>
        <p className="ref text-[11.5px] text-[var(--color-ink-3)] mt-3 rule pt-2.5">
          Password: DemoPass123! — tap a row to fill the form.
        </p>
      </Card>
    </div>
  );
}
