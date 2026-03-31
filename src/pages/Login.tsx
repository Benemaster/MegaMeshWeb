import { useState, FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';

export const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    
    try {
      await login(username, password);
      navigate('/connect');
    } catch (err) {
      setError('Login fehlgeschlagen. Bitte überprüfe deine Zugangsdaten.');
    }
  };

  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center bg-surface px-4 py-12">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/3 h-[400px] w-[400px] rounded-full bg-primary-600/8 blur-[100px]" />
        <div className="absolute -bottom-40 right-1/3 h-[300px] w-[300px] rounded-full bg-cyber-500/8 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-fade-in-up">
        {/* Logo */}
        <div className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-cyber-500">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
              </svg>
            </div>
            <span className="text-2xl font-bold text-white">MegaMesh</span>
          </Link>
        </div>

        {/* Card */}
        <div className="glass-card glow-border p-8">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white">Willkommen zurueck</h2>
            <p className="mt-1 text-sm text-gray-400">Melde dich in deinem Konto an</p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="username" className="mb-1.5 block text-xs font-medium text-gray-400">
                  Benutzername
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  className="input-cyber"
                  placeholder="Dein Benutzername"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-gray-400">
                  Passwort
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  className="input-cyber"
                  placeholder="Dein Passwort"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <button type="submit" className="btn-primary w-full">
              Anmelden
            </button>
            
            <p className="text-center text-sm text-gray-500">
              Noch kein Konto?{' '}
              <Link to="/register" className="font-medium text-primary-400 hover:text-primary-300 transition-colors">
                Registrieren
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};
