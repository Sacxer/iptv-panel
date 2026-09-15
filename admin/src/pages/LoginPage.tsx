import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, Moon, Sun, Tv } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../api';
import { useTheme } from '../hooks/useTheme';
import { Alert, FormField, Spinner } from '../components/ui';

interface LocationState {
  from?: string;
  expired?: boolean;
}

export function LoginPage() {
  const { user, checking, login } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  if (!checking && user) return <Navigate to={state.from && state.from !== '/login' ? state.from : '/'} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate(state.from && state.from !== '/login' ? state.from : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <button type="button" className="btn btn-ghost btn-icon login-theme" onClick={toggle} title="Cambiar tema">
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <div className="login-brand">
          <span className="brand-logo brand-logo-lg">
            <Tv size={26} />
          </span>
          <h1>Panel IPTV</h1>
          <p className="muted">Inicia sesión para administrar tu plataforma</p>
        </div>

        {state.expired && !error && (
          <Alert tone="amber">Tu sesión expiró. Vuelve a iniciar sesión.</Alert>
        )}
        {error && <Alert tone="red">{error}</Alert>}

        <FormField label="Usuario" htmlFor="login-user" error={touched && !username.trim() ? 'Ingresa tu usuario' : null}>
          <input
            id="login-user"
            className="input"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </FormField>
        <FormField label="Contraseña" htmlFor="login-pass" error={touched && !password ? 'Ingresa tu contraseña' : null}>
          <div className="input-group">
            <input
              id="login-pass"
              className="input"
              type={showPass ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={() => setShowPass((s) => !s)}
              title={showPass ? 'Ocultar' : 'Mostrar'}
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </FormField>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <Spinner size={16} /> : <LogIn size={16} />}
          Iniciar sesión
        </button>
      </form>
    </div>
  );
}
