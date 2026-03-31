import { Link } from 'react-router-dom';

const GITHUB_URL = 'https://github.com/Gropp-Linnhoff-Industries/MegaMeshWeb';

const features = [
  {
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
      </svg>
    ),
    title: 'LoRa Mesh-Netzwerk',
    desc: 'Kommunikation ueber grosse Distanzen ohne Internet oder Mobilfunk — vollstaendig dezentral ueber LoRa-Funk.',
  },
  {
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    title: 'AES-128 Verschluesselung',
    desc: 'Ende-zu-Ende verschluesselte Nachrichten mit individuellem Key-Management pro Kontakt.',
  },
  {
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
      </svg>
    ),
    title: 'Wetterstationen',
    desc: 'Integrierte Wetterdaten-Erfassung mit Live-Karte aller Mesh-Stationen.',
  },
  {
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
      </svg>
    ),
    title: 'Web-Interface',
    desc: 'Steuere dein Mesh-Netzwerk direkt im Browser — ueber Bluetooth oder USB-Seriell.',
  },
  {
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
    title: 'Multi-Hop Routing',
    desc: 'Nachrichten finden automatisch den besten Weg ueber mehrere Nodes zum Ziel.',
  },
  {
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
      </svg>
    ),
    title: 'QR-Code Key-Tausch',
    desc: 'Verschluesselungs-Keys bequem per QR-Code mit anderen Nodes austauschen.',
  },
];

export const Landing = () => {
  return (
    <div className="mesh-bg min-h-screen bg-surface">
      {/* Ambient glow orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-[500px] w-[500px] rounded-full bg-primary-600/10 blur-[120px] animate-glow-pulse" />
        <div className="absolute -bottom-40 right-1/4 h-[400px] w-[400px] rounded-full bg-cyber-500/10 blur-[120px] animate-glow-pulse" style={{ animationDelay: '1.5s' }} />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-white/5">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-cyber-500">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
              </svg>
            </div>
            <span className="text-xl font-bold tracking-tight text-white">MegaMesh</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              GitHub
            </a>
            <Link to="/login" className="btn-primary">
              Anmelden
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20 pt-24 text-center sm:pt-32">
        <div className="animate-fade-in-up">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-primary-500/20 bg-primary-500/5 px-4 py-1.5 text-sm text-primary-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-500" />
            </span>
            Open-Source LoRa Mesh-Kommunikation
          </div>

          <h1 className="mx-auto max-w-4xl text-5xl font-extrabold tracking-tight text-white sm:text-7xl">
            <span className="bg-gradient-to-r from-white via-white to-gray-400 bg-clip-text text-transparent">
              Dein dezentrales
            </span>
            <br />
            <span className="bg-gradient-to-r from-primary-400 to-cyber-400 bg-clip-text text-transparent">
              Mesh-Netzwerk
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-400">
            MegaMesh verbindet ESP32-Nodes ueber LoRa-Funk zu einem selbstorganisierenden Mesh-Netzwerk.
            Nachrichten, Wetterdaten und mehr — verschluesselt, dezentral und unabhaengig.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link to="/register" className="btn-primary px-8 py-3 text-base">
              Jetzt starten
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex items-center gap-2 px-8 py-3 text-base"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              Quellcode ansehen
            </a>
          </div>
        </div>

        {/* Decorative node visualization */}
        <div className="relative mx-auto mt-20 max-w-3xl animate-fade-in" style={{ animationDelay: '0.3s' }}>
          <div className="glass-card overflow-hidden p-1">
            <div className="rounded-lg bg-surface-50 p-6">
              <div className="flex items-center gap-2 border-b border-white/5 pb-4">
                <div className="h-3 w-3 rounded-full bg-red-500/60" />
                <div className="h-3 w-3 rounded-full bg-yellow-500/60" />
                <div className="h-3 w-3 rounded-full bg-green-500/60" />
                <span className="ml-3 text-xs text-gray-500">MegaMesh Dashboard</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4">
                <div className="rounded-lg border border-white/5 bg-surface-200/50 p-4">
                  <div className="mb-2 text-xs text-gray-500">Aktive Nodes</div>
                  <div className="text-2xl font-bold text-primary-400">12</div>
                </div>
                <div className="rounded-lg border border-white/5 bg-surface-200/50 p-4">
                  <div className="mb-2 text-xs text-gray-500">Nachrichten</div>
                  <div className="text-2xl font-bold text-cyber-400">847</div>
                </div>
                <div className="rounded-lg border border-white/5 bg-surface-200/50 p-4">
                  <div className="mb-2 text-xs text-gray-500">Reichweite</div>
                  <div className="text-2xl font-bold text-green-400">15km</div>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                {['0xA3F1', '0x7B2C', '0xE9D4', '0x1F8A'].map((id) => (
                  <div key={id} className="flex items-center gap-2 rounded-md border border-white/5 bg-surface-300/50 px-3 py-2">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    <span className="font-mono text-xs text-gray-400">{id}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative z-10 border-t border-white/5 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">
              Alles was du brauchst
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-gray-400">
              MegaMesh kombiniert leistungsstarke Hardware mit einer modernen Web-Oberflaeche
              fuer nahtlose Mesh-Kommunikation.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <div
                key={i}
                className="glass-card-hover group p-6"
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                <div className="mb-4 inline-flex rounded-lg bg-primary-500/10 p-3 text-primary-400 transition-colors group-hover:bg-primary-500/20 group-hover:text-primary-300">
                  {f.icon}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white">{f.title}</h3>
                <p className="text-sm leading-relaxed text-gray-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative z-10 border-t border-white/5 py-24">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-16 text-center text-3xl font-bold text-white sm:text-4xl">
            So funktioniert's
          </h2>

          <div className="grid gap-8 sm:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Node verbinden',
                desc: 'Verbinde deinen ESP32 per Bluetooth oder USB mit dem Browser.',
              },
              {
                step: '02',
                title: 'Netzwerk aufbauen',
                desc: 'Scanne nach anderen Nodes und baue dein Mesh-Netzwerk auf.',
              },
              {
                step: '03',
                title: 'Kommunizieren',
                desc: 'Sende verschluesselte Nachrichten und teile Wetterdaten.',
              },
            ].map((item, i) => (
              <div key={i} className="relative text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-primary-500/20 bg-primary-500/5">
                  <span className="text-lg font-bold text-primary-400">{item.step}</span>
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white">{item.title}</h3>
                <p className="text-sm text-gray-400">{item.desc}</p>
                {i < 2 && (
                  <div className="absolute right-0 top-7 hidden w-8 translate-x-1/2 sm:block">
                    <svg className="w-full text-primary-500/30" fill="none" viewBox="0 0 24 8" stroke="currentColor" strokeWidth={1}>
                      <path d="M0 4h20M16 0l4 4-4 4" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tech stack */}
      <section className="relative z-10 border-t border-white/5 py-24">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-12 text-center text-3xl font-bold text-white">Technologie</h2>
          <div className="glass-card grid grid-cols-2 gap-6 p-8 sm:grid-cols-4">
            {[
              { name: 'ESP32-S3', desc: 'Heltec LoRa V4' },
              { name: 'LoRa', desc: '868 MHz EU-Band' },
              { name: 'React', desc: 'Web-Oberflaeche' },
              { name: 'Web Bluetooth', desc: 'Browser-Anbindung' },
            ].map((t, i) => (
              <div key={i} className="text-center">
                <p className="text-lg font-bold text-white">{t.name}</p>
                <p className="mt-1 text-xs text-gray-500">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 border-t border-white/5 py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Bereit fuer dezentrale Kommunikation?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-gray-400">
            Starte jetzt mit MegaMesh und baue dein eigenes Mesh-Netzwerk auf.
            Open Source und kostenlos.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link to="/register" className="btn-primary px-8 py-3 text-base">
              Kostenlos registrieren
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex items-center gap-2 px-8 py-3 text-base"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-primary-500 to-cyber-500">
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0" />
                </svg>
              </div>
              MegaMesh — Gropp-Linnhoff Industries
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-500">
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="hover:text-gray-300 transition-colors">
                GitHub
              </a>
              <Link to="/login" className="hover:text-gray-300 transition-colors">
                Anmelden
              </Link>
              <Link to="/register" className="hover:text-gray-300 transition-colors">
                Registrieren
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
