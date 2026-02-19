import { useEffect, useMemo, useRef, useState } from 'react';
import { bluetoothService } from '../services/bluetoothService';
import { serialService } from '../services/serialService';
import type { BluetoothEvent, CfgStatusEvent, ConfigField, SetupInfoEvent } from '../types/bluetooth';

const RADIO_ERR: Record<string, string> = {
  '-2': 'Allgemeiner Funkfehler (Pins, TCXO und Verdrahtung prüfen)',
  '-3': 'Ungültige Frequenz',
  '-4': 'Funkchip nicht gefunden',
  '-5': 'Ungültige Ausgangsleistung',
  '-6': 'Ungültige Bandbreite',
  '-7': 'Ungültiger Spreading Factor',
  '-8': 'Ungültige Coding Rate',
  '-701': 'SPI-Kommunikation fehlgeschlagen',
  '-706': 'SPI Timeout',
};

type ConfigPhase = 'idle' | 'config_mode' | 'saving' | 'initing' | 'done' | 'error';

interface FieldState {
  value: string;
  dirty: boolean;
  acking: boolean;
  error: string;
}

interface Props {
  onMeshStarted?: (nodeId: number) => void;
  transport?: 'bluetooth' | 'serial';
}

interface SetupStep {
  title: string;
  description: string;
  keys: string[];
}

type QuickDeviceProfile = 'heltec_v3' | 'megamesh';

const FIELD_LABELS: Record<string, string> = {
  device: 'Gerätetyp',
  freq: 'Frequenz',
  bw: 'Bandbreite',
  sf: 'Spreading Factor',
  cr: 'Coding Rate',
  pwr: 'Sendeleistung',
  sw: 'Sync Word',
  preamble: 'Preamble-Länge',
  tcxo: 'TCXO-Spannung',
  dio2: 'DIO2 als RF-Switch',
  sclk: 'SCLK-Pin',
  miso: 'MISO-Pin',
  mosi: 'MOSI-Pin',
  nss: 'NSS/CS-Pin',
  rst: 'RESET-Pin',
  dio0: 'DIO0/BUSY-Pin',
  dio1: 'DIO1/IRQ-Pin',
  weather: 'Wettermodus',
  weather_interval: 'Wetter-Intervall',
  weather_sensors: 'Anzahl Wetter-Sensoren',
};

const STEPS: SetupStep[] = [
  {
    title: '1. Hardware',
    description: 'Wähle den Board-Typ und prüfe die Pinbelegung.',
    keys: ['device', 'sclk', 'miso', 'mosi', 'nss', 'rst', 'dio0', 'dio1'],
  },
  {
    title: '2. Funk',
    description: 'Lege LoRa-Parameter über Auswahllisten fest.',
    keys: ['freq', 'bw', 'sf', 'cr', 'pwr', 'sw', 'preamble', 'tcxo', 'dio2'],
  },
  {
    title: '3. Wetter',
    description: 'Aktiviere optional den Wettermodus und Intervall.',
    keys: ['weather', 'weather_interval', 'weather_sensors'],
  },
  {
    title: '4. Start',
    description: 'Konfiguration speichern, Funk initialisieren und Mesh starten.',
    keys: [],
  },
];

export const DeviceConfigurator = ({ onMeshStarted, transport = 'bluetooth' }: Props) => {
  const commandService = transport === 'serial' ? serialService : bluetoothService;
  const [phase, setPhase] = useState<ConfigPhase>('idle');
  const [meshRunning, setMeshRunning] = useState(false);
  const [setupInfo, setSetupInfo] = useState<SetupInfoEvent | null>(null);
  const [cfgStatus, setCfgStatus] = useState<CfgStatusEvent | null>(null);
  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({});
  const [radioError, setRadioError] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<number | null>(null);
  const [log, setLog] = useState<BluetoothEvent[]>([]);
  const [pendingAck, setPendingAck] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [isFirstSetup, setIsFirstSetup] = useState(false);
  const [showAdvancedFirstSetup, setShowAdvancedFirstSetup] = useState(false);
  const [quickDevice, setQuickDevice] = useState<QuickDeviceProfile>('heltec_v3');
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState('');
  const [initWarning, setInitWarning] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  useEffect(() => {
    const unsubscribe = commandService.addEventListener(handleEvent);
    if (commandService.isConnected()) {
      commandService.sendCommand('setup').catch(() => {});
      setTimeout(() => {
        commandService.sendCommand('info').catch(() => {});
      }, 120);
    }
    return () => unsubscribe();
  }, [commandService]);

  const fieldsByKey = useMemo(() => {
    const map = new Map<string, ConfigField>();
    if (!setupInfo) return map;
    for (const field of setupInfo.fields) {
      map.set(field.k, field);
    }
    return map;
  }, [setupInfo]);

  const extraFields = useMemo(() => {
    if (!setupInfo) return [] as ConfigField[];
    const defined = new Set(STEPS.flatMap(s => s.keys));
    return setupInfo.fields.filter(f => !defined.has(f.k));
  }, [setupInfo]);

  function addLog(evt: BluetoothEvent) {
    setLog(prev => [...prev.slice(-99), evt]);
  }

  function initFieldStates(si: SetupInfoEvent) {
    setFieldStates(prev => {
      const next: Record<string, FieldState> = { ...prev };
      for (const f of si.fields) {
        const key = f.k;
        const incoming = String(f.v);
        const existing = prev[key];

        if (!existing) {
          next[key] = { value: incoming, dirty: false, acking: false, error: '' };
          continue;
        }

        if (existing.dirty || existing.acking) {
          next[key] = existing;
          continue;
        }

        next[key] = { ...existing, value: incoming };
      }
      return next;
    });
  }

  function handleEvent(evt: BluetoothEvent) {
    addLog(evt);

    switch (evt.evt) {
      case 'first_boot':
        setIsFirstSetup(true);
        setShowAdvancedFirstSetup(false);
        setPhase('config_mode');
        commandService.sendCommand('setup').catch(() => {});
        break;

      case 'config_mode':
        setPhase('config_mode');
        break;

      case 'serial_setup_ready':
      case 'setup_already':
        setPhase('config_mode');
        break;

      case 'boot':
        setIsFirstSetup(false);
        break;

      case 'setup_info': {
        const si = evt as SetupInfoEvent;
        setSetupInfo(si);
        if (typeof si.first_setup === 'boolean') {
          setIsFirstSetup(si.first_setup);
        }
        setPhase('config_mode');
        initFieldStates(si);
        break;
      }

      case 'cfg_status':
        setCfgStatus(evt as CfgStatusEvent);
        break;

      case 'defaults_applied':
        commandService.sendCommand('info').catch(() => {});
        break;

      case 'ok':
        if (pendingAck) {
          setFieldStates(prev => ({
            ...prev,
            [pendingAck]: { ...prev[pendingAck], acking: false, dirty: false, error: '' },
          }));
          setPendingAck(null);
        }
        break;

      case 'unknown_cmd':
        if (pendingAck) {
          setFieldStates(prev => ({
            ...prev,
            [pendingAck]: { ...prev[pendingAck], acking: false, error: 'Befehl nicht erkannt' },
          }));
          setPendingAck(null);
        }
        break;

      case 'cfg_saved':
        setCfgStatus(prev => ({
          evt: 'cfg_status',
          saved: true,
          radio_ok: prev?.radio_ok ?? false,
          hint: prev?.hint ?? '',
        }));
        setPhase('config_mode');
        break;

      case 'cfg_staged':
        setCfgStatus(prev => ({
          evt: 'cfg_status',
          saved: true,
          radio_ok: prev?.radio_ok ?? false,
          hint: 'Konfiguration vorgemerkt',
        }));
        setPhase('config_mode');
        break;

      case 'setup_required':
        setPhase('config_mode');
        commandService.sendCommand('setup').catch(() => {});
        break;

      case 'auto_init':
        setPhase('initing');
        break;

      case 'radio_ready':
        setCfgStatus(prev => ({
          evt: 'cfg_status',
          saved: prev?.saved ?? false,
          radio_ok: true,
          hint: prev?.hint ?? '',
        }));
        setInitWarning(null);
        setPhase('config_mode');
        break;

      case 'radio_not_ready':
        setInitWarning('Funk noch nicht bereit. Bitte zuerst initialisieren.');
        setPhase('config_mode');
        break;

      case 'radio_err': {
        const code = String(evt.code ?? '');
        const label = RADIO_ERR[code] ?? `Code ${code}`;
        const text = `Funk-Initialisierung fehlgeschlagen: ${label}`;
        const isUserInitFlow = phase === 'initing' || quickBusy;

        if (isUserInitFlow) {
          setRadioError(text);
          setQuickBusy(false);
          setPhase('error');
        } else {
          setInitWarning(text);
          setPhase('config_mode');
        }
        break;
      }

      case 'mesh_started':
        setQuickBusy(false);
        setNodeId(evt.nodeId);
        setMeshRunning(true);
        setPhase('done');
        if (onMeshStarted) onMeshStarted(evt.nodeId);
        break;

      case 'autostart_ok':
        setQuickBusy(false);
        setPhase('done');
        break;

      case 'autostart_err':
        setQuickBusy(false);
        setQuickError('Auto-Start fehlgeschlagen. Bitte erweitertes Setup nutzen.');
        setPhase('config_mode');
        break;

      case 'reconnected':
        commandService.sendCommand('info').catch(() => {});
        break;
    }
  }

  function fieldLabel(field: ConfigField): string {
    return FIELD_LABELS[field.k] ?? field.k;
  }

  function getOptions(field: ConfigField): string[] {
    if (field.opts) return field.opts.split('|');

    if (field.type === 'pin') {
      return Array.from({ length: 40 }, (_, i) => String(i));
    }

    if (field.k === 'weather_interval') {
      return ['5000', '10000', '30000', '60000', '300000'];
    }

    if (field.min !== undefined && field.max !== undefined) {
      const min = Math.ceil(field.min);
      const max = Math.floor(field.max);
      if (Number.isInteger(min) && Number.isInteger(max) && max - min <= 12) {
        return Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
      }
    }

    return [];
  }

  function normalizeLabel(field: ConfigField, option: string): string {
    if (field.k === 'device') {
      if (option === 'heltec' || option === 'heltec_v3') return 'Heltec V3 (GPIO 8-14 LoRa)';
      if (option === 'wroom' || option === 'megamesh') return 'MegaMesh-Gerät';
    }
    if (field.k === 'weather' || field.k === 'dio2') {
      return option === '1' ? 'Ein' : 'Aus';
    }
    return option;
  }

  function validateField(field: ConfigField, value: string): string {
    if (field.k === 'weather_sensors') return '';

    if (field.type === 'hex') {
      if (!/^0x[0-9A-Fa-f]{1,2}$/.test(value)) return 'Format muss 0x00 bis 0xFF sein';
      return '';
    }

    if (field.type === 'pin' || (field.min !== undefined && field.max !== undefined)) {
      const num = Number(value);
      if (Number.isNaN(num)) return 'Bitte eine Zahl wählen';
      const min = field.type === 'pin' ? 0 : (field.min ?? 0);
      const max = field.type === 'pin' ? 39 : (field.max ?? Infinity);
      if (num < min || num > max) return `Wert muss zwischen ${min} und ${max} liegen`;
    }

    return '';
  }

  async function applyField(field: ConfigField, value: string) {
    const err = validateField(field, value);
    if (err) {
      setFieldStates(prev => ({ ...prev, [field.k]: { ...prev[field.k], value, error: err } }));
      return;
    }

    setFieldStates(prev => ({
      ...prev,
      [field.k]: { ...prev[field.k], value, dirty: true, acking: field.k !== 'device', error: '' },
    }));

    if (field.k === 'device') {
      await commandService.sendCommand(`device ${value}`).catch(() => {
        setFieldStates(prev => ({
          ...prev,
          [field.k]: { ...prev[field.k], acking: false, error: 'Senden fehlgeschlagen' },
        }));
      });
      return;
    }

    setPendingAck(field.k);
    await commandService.sendCommand(`set ${field.k} ${value}`).catch(() => {
      setFieldStates(prev => ({
        ...prev,
        [field.k]: { ...prev[field.k], acking: false, error: 'Senden fehlgeschlagen' },
      }));
      setPendingAck(null);
    });
  }

  async function handleSave() {
    setPhase('saving');
    await commandService.sendCommand('setup').catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 120));
    await commandService.sendCommand('save').catch(() => {
      setPhase('config_mode');
    });
  }

  async function handleInit() {
    setInitWarning(null);
    setPhase('initing');
    await commandService.sendCommand('init').catch(() => {
      setPhase('config_mode');
    });
  }

  async function handleStartMesh() {
    await commandService.sendCommand('startmesh').catch(() => {});
  }

  async function handleReboot() {
    if (window.confirm('Gerät jetzt neu starten?')) {
      await commandService.sendCommand('reboot').catch(() => {});
    }
  }

  async function handleQuickFirstSetup() {
    setQuickError('');
    setInitWarning(null);
    setQuickBusy(true);

    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    try {
      await commandService.sendCommand(`device ${quickDevice}`);
      await wait(180);
      await commandService.sendCommand('save');
      await wait(180);
      setPhase('initing');
      await commandService.sendCommand('init');
    } catch (err) {
      setQuickBusy(false);
      setPhase('config_mode');
      setQuickError(`Schnell-Setup fehlgeschlagen: ${(err as Error).message}`);
    }
  }

  async function handleAutoStart() {
    setQuickError('');
    setInitWarning(null);
    setQuickBusy(true);
    try {
      await commandService.sendCommand(`device ${quickDevice}`);
      await new Promise(resolve => setTimeout(resolve, 140));
      await commandService.sendCommand('autostart');
    } catch (err) {
      setQuickBusy(false);
      setQuickError(`Auto-Start fehlgeschlagen: ${(err as Error).message}`);
    }
  }

  function renderField(field: ConfigField) {
    const state = fieldStates[field.k] ?? {
      value: String(field.v),
      dirty: false,
      acking: false,
      error: '',
    };

    const options = getOptions(field);
    const isReadonly = field.k === 'weather_sensors';

    return (
      <div key={field.k} className="rounded-lg border border-gray-200 p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <span>{fieldLabel(field)}</span>
          {field.unit && <span className="text-gray-400">({field.unit})</span>}
          {state.acking && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />}
        </div>

        {isReadonly ? (
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{state.value}</div>
        ) : options.length > 0 ? (
          options.length <= 6 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {options.map(option => (
                <button
                  key={`${field.k}-${option}`}
                  type="button"
                  disabled={state.acking}
                  onClick={() => applyField(field, option)}
                  className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                    state.value === option
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  } ${state.acking ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  {normalizeLabel(field, option)}
                </button>
              ))}
            </div>
          ) : (
            <select
              className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                state.error ? 'border-red-400' : 'border-gray-300'
              }`}
              value={state.value}
              disabled={state.acking}
              onChange={e => applyField(field, e.target.value)}
            >
              {options.map(option => (
                <option key={`${field.k}-${option}`} value={option}>
                  {normalizeLabel(field, option)}
                </option>
              ))}
            </select>
          )
        ) : (
          <input
            type={field.type === 'hex' ? 'text' : 'number'}
            className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              state.error ? 'border-red-400' : 'border-gray-300'
            }`}
            value={state.value}
            disabled={state.acking}
            min={field.type === 'pin' ? 0 : field.min}
            max={field.type === 'pin' ? 39 : field.max}
            step={field.unit === 'MHz' || field.unit === 'kHz' || field.unit === 'V' ? 'any' : 1}
            onChange={e => {
              const value = e.target.value;
              setFieldStates(prev => ({
                ...prev,
                [field.k]: { ...prev[field.k], value, dirty: true, error: '' },
              }));
            }}
            onBlur={e => applyField(field, e.target.value)}
          />
        )}

        {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
      </div>
    );
  }

  function stepFields(step: SetupStep): ConfigField[] {
    if (!setupInfo) return [];
    return step.keys.map(key => fieldsByKey.get(key)).filter((f): f is ConfigField => !!f);
  }

  if (phase === 'done') {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-green-400 bg-green-50 p-6 text-center text-green-800">
          <div className="mb-2 text-3xl">✓</div>
          <p className="text-lg font-semibold">Setup abgeschlossen</p>
          {nodeId !== null && <p className="mt-1 font-mono text-sm">Node-ID: {nodeId}</p>}
          <p className="mt-2 text-sm">Mesh läuft.</p>
        </div>
        <button
          onClick={handleReboot}
          className="w-full rounded-md bg-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-300"
        >
          Gerät neu starten
        </button>
        <EventLog log={log} logEndRef={logEndRef} />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-400 bg-red-50 p-4 text-red-800">
          <p className="font-semibold">Fehler</p>
          <p className="mt-1 text-sm">{radioError ?? 'Unbekannter Fehler'}</p>
        </div>
        <button
          onClick={() => {
            setPhase('config_mode');
            setRadioError(null);
          }}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Zurück zum Setup
        </button>
        <EventLog log={log} logEndRef={logEndRef} />
      </div>
    );
  }

  if (!setupInfo || phase === 'idle') {
    return (
      <div className="space-y-4">
        <div className="flex items-center space-x-3 text-gray-500">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span className="text-sm">Warte auf Setup-Daten vom Gerät …</span>
        </div>
        <EventLog log={log} logEndRef={logEndRef} />
      </div>
    );
  }

  const isBusy = phase === 'saving' || phase === 'initing';
  const currentStep = STEPS[activeStep];
  const currentFields = stepFields(currentStep);
  const compactKeys = new Set(['device', 'freq', 'bw', 'sf', 'cr', 'pwr']);
  const visibleCurrentFields = showAdvanced ? currentFields : currentFields.filter(field => compactKeys.has(field.k));
  const fieldsToRender = visibleCurrentFields.length > 0 ? visibleCurrentFields : currentFields;
  const savedLabel = cfgStatus ? (cfgStatus.saved ? 'ja' : 'nein') : 'unbekannt';
  const radioLabel = cfgStatus ? (cfgStatus.radio_ok ? 'bereit' : 'nicht bereit') : 'unbekannt';

  if (isFirstSetup && !showAdvancedFirstSetup) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h3 className="text-base font-semibold text-blue-900">Vereinfachtes Erstsetup</h3>
          <p className="mt-1 text-sm text-blue-800">
            Wähle dein Gerät. Die Standardwerte werden automatisch gesetzt, gespeichert und der Funk wird initialisiert.
          </p>
          <p className="mt-1 text-xs text-blue-700">
            Heltec V3 Pinout: NSS=GPIO8, SCK=GPIO9, MOSI=GPIO10, MISO=GPIO11, RST=GPIO12, BUSY=GPIO13, DIO1=GPIO14.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={quickBusy}
            onClick={() => setQuickDevice('heltec_v3')}
            className={`rounded-md border px-4 py-3 text-left ${
              quickDevice === 'heltec_v3'
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <p className="font-medium">Heltec V3</p>
            <p className={`text-xs ${quickDevice === 'heltec_v3' ? 'text-blue-100' : 'text-gray-500'}`}>
              Für Heltec WiFi LoRa 32 V3
            </p>
          </button>

          <button
            type="button"
            disabled={quickBusy}
            onClick={() => setQuickDevice('megamesh')}
            className={`rounded-md border px-4 py-3 text-left ${
              quickDevice === 'megamesh'
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <p className="font-medium">MegaMesh-Gerät</p>
            <p className={`text-xs ${quickDevice === 'megamesh' ? 'text-blue-100' : 'text-gray-500'}`}>
              Für dein eigenes MegaMesh-Hardwareprofil
            </p>
          </button>
        </div>

        {phase === 'initing' && (
          <div className="flex items-center space-x-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <span>Funkmodul wird initialisiert …</span>
          </div>
        )}

        {quickError && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {quickError}
          </div>
        )}

        <button
          type="button"
          disabled={quickBusy || isBusy}
          onClick={handleQuickFirstSetup}
          className="w-full rounded-md bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {quickBusy ? 'Setup läuft …' : 'Schnell-Setup starten'}
        </button>

        <button
          type="button"
          disabled={quickBusy || isBusy}
          onClick={() => setShowAdvancedFirstSetup(true)}
          className="w-full rounded-md bg-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-300 disabled:opacity-50"
        >
          Erweiterte Einstellungen anzeigen
        </button>

        <EventLog log={log} logEndRef={logEndRef} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h3 className="text-base font-semibold text-blue-900">Schnellstart (empfohlen)</h3>
        <p className="mt-1 text-sm text-blue-800">Wähle ein Geräteprofil und starte Speichern + LoRa-Init + Mesh mit einem Klick.</p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={quickBusy || isBusy}
            onClick={() => setQuickDevice('heltec_v3')}
            className={`rounded-md border px-4 py-3 text-left ${
              quickDevice === 'heltec_v3'
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <p className="font-medium">Heltec V3</p>
            <p className={`text-xs ${quickDevice === 'heltec_v3' ? 'text-blue-100' : 'text-gray-500'}`}>
              Standard-Pinout Heltec
            </p>
          </button>

          <button
            type="button"
            disabled={quickBusy || isBusy}
            onClick={() => setQuickDevice('megamesh')}
            className={`rounded-md border px-4 py-3 text-left ${
              quickDevice === 'megamesh'
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <p className="font-medium">MegaMesh-Gerät</p>
            <p className={`text-xs ${quickDevice === 'megamesh' ? 'text-blue-100' : 'text-gray-500'}`}>
              Eigenes Hardwareprofil
            </p>
          </button>
        </div>

        <button
          type="button"
          disabled={quickBusy || isBusy}
          onClick={handleAutoStart}
          className="mt-3 w-full rounded-md bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {quickBusy ? 'Auto-Start läuft …' : 'Auto-Start: Speichern + LoRa + Mesh'}
        </button>

        {quickError && <p className="mt-2 text-sm text-red-700">{quickError}</p>}
      </div>

      <div className="flex flex-wrap gap-3 text-xs font-mono">
        <span className={`rounded px-2 py-1 ${!cfgStatus ? 'bg-gray-100 text-gray-600' : cfgStatus.saved ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
          gespeichert: {savedLabel}
        </span>
        <span className={`rounded px-2 py-1 ${!cfgStatus ? 'bg-gray-100 text-gray-600' : cfgStatus.radio_ok ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
          funk: {radioLabel}
        </span>
        <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">
          mesh: {meshRunning ? 'läuft' : 'unbekannt/gestoppt'}
        </span>
      </div>

      <div className="flex items-center justify-between rounded border border-gray-200 bg-gray-50 px-3 py-2">
        <p className="text-sm text-gray-700">Ansicht</p>
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className="rounded-md bg-white px-3 py-1 text-xs text-gray-700 border border-gray-300 hover:bg-gray-100"
        >
          {showAdvanced ? 'Einfach' : 'Erweitert'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((step, idx) => (
          <button
            key={step.title}
            type="button"
            onClick={() => setActiveStep(idx)}
            className={`rounded-md border px-3 py-2 text-sm ${
              idx === activeStep
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {step.title}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900">{currentStep.title}</h3>
        <p className="mt-1 text-sm text-gray-600">{currentStep.description}</p>
      </div>

      {initWarning && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {initWarning}
        </div>
      )}

      {phase === 'saving' && (
        <div className="flex items-center space-x-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span>Konfiguration wird gespeichert …</span>
        </div>
      )}

      {phase === 'initing' && (
        <div className="flex items-center space-x-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span>Funkmodul wird initialisiert …</span>
        </div>
      )}

      {activeStep < STEPS.length - 1 ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fieldsToRender.map(field => renderField(field))}
          </div>

          {showAdvanced && activeStep === 2 && extraFields.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-700">Weitere Werte</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{extraFields.map(field => renderField(field))}</div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              disabled={activeStep === 0}
              onClick={() => setActiveStep(v => Math.max(0, v - 1))}
              className="flex-1 rounded-md bg-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Zurück
            </button>
            <button
              type="button"
              onClick={() => setActiveStep(v => Math.min(STEPS.length - 1, v + 1))}
              className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Weiter
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              disabled={isBusy}
              onClick={handleSave}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              1) In Flash speichern
            </button>
            <button
              disabled={isBusy || !cfgStatus?.saved}
              onClick={handleInit}
              title={!cfgStatus?.saved ? 'Bitte zuerst speichern' : ''}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              2) Funk initialisieren
            </button>
            <button
              disabled={isBusy || !cfgStatus?.radio_ok}
              onClick={handleStartMesh}
              title={!cfgStatus?.radio_ok ? 'Funk noch nicht bereit' : ''}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              3) Mesh starten
            </button>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setActiveStep(STEPS.length - 2)}
              className="flex-1 rounded-md bg-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-300"
            >
              Zurück zu Schritt 3
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={handleReboot}
              className="flex-1 rounded-md bg-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-300 disabled:opacity-50"
            >
              Gerät neu starten
            </button>
            {transport === 'bluetooth' && (
              <button
                type="button"
                disabled={isBusy}
                onClick={async () => {
                  if (window.confirm('Bluetooth wird ausgeschaltet und die Verbindung getrennt. Fortfahren?')) {
                    await commandService.sendCommand('bt off').catch(() => {});
                  }
                }}
                className="flex-1 rounded-md bg-orange-100 px-4 py-2 text-sm text-orange-700 hover:bg-orange-200 disabled:opacity-50"
              >
                Bluetooth aus
              </button>
            )}
          </div>
        </div>
      )}

      <EventLog log={log} logEndRef={logEndRef} />
    </div>
  );
};

interface EventLogProps {
  log: BluetoothEvent[];
  logEndRef: React.RefObject<HTMLDivElement>;
}

function EventLog({ log, logEndRef }: EventLogProps) {
  const [open, setOpen] = useState(false);

  if (log.length === 0) return null;

  return (
    <div className="border-t pt-4">
      <button
        type="button"
        className="mb-2 text-xs text-gray-500 underline"
        onClick={() => setOpen(v => !v)}
      >
        {open ? 'Event-Log ausblenden' : 'Event-Log anzeigen'} ({log.length})
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto rounded-lg bg-gray-900 p-3 font-mono text-xs">
          {log.map((evt, i) => (
            <div key={i} className="border-b border-gray-800 py-0.5 text-green-400 last:border-0">
              {JSON.stringify(evt)}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}
