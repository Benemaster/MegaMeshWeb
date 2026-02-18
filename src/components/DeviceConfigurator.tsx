import { useState, useEffect, useRef } from 'react';
import { bluetoothService } from '../services/bluetoothService';
import type { BluetoothEvent, ConfigField, SetupInfoEvent, CfgStatusEvent } from '../types/bluetooth';

// RadioLib error code lookup
const RADIO_ERR: Record<string, string> = {
  '-2': 'ERR_UNKNOWN',
  '-4': 'ERR_CHIP_NOT_FOUND',
  '-6': 'ERR_INVALID_BANDWIDTH',
  '-7': 'ERR_INVALID_SPREADING_FACTOR',
  '-701': 'ERR_SPI_CMD_FAILED',
};

type ConfigPhase =
  | 'idle'
  | 'config_mode'
  | 'saving'
  | 'initing'
  | 'done'
  | 'error';

interface FieldState {
  value: string;
  dirty: boolean;
  acking: boolean;
  error: string;
}

interface Props {
  onMeshStarted?: (nodeId: number) => void;
}

export const DeviceConfigurator = ({ onMeshStarted }: Props) => {
  const [phase, setPhase] = useState<ConfigPhase>('idle');
  const [meshRunning, setMeshRunning] = useState(false);
  const [setupInfo, setSetupInfo] = useState<SetupInfoEvent | null>(null);
  const [cfgStatus, setCfgStatus] = useState<CfgStatusEvent | null>(null);
  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({});
  const [radioError, setRadioError] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<number | null>(null);
  const [log, setLog] = useState<BluetoothEvent[]>([]);
  const [pendingAck, setPendingAck] = useState<string | null>(null); // key waiting for 'ok'
  const logEndRef = useRef<HTMLDivElement>(null);

  // Scroll log to bottom on new entries
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  // Register event handler once
  useEffect(() => {
    bluetoothService.onEvent(handleEvent);
    // Send 'info' to request setup_info if device is already connected
    if (bluetoothService.isConnected()) {
      bluetoothService.sendCommand('info').catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addLog(evt: BluetoothEvent) {
    setLog(prev => [...prev.slice(-99), evt]);
  }

  function handleEvent(evt: BluetoothEvent) {
    addLog(evt);

    switch (evt.evt) {
      case 'first_boot':
      case 'config_mode':
        setPhase('config_mode');
        // Request full field manifest
        bluetoothService.sendCommand('info').catch(() => {});
        break;

      case 'boot':
        // Normal boot — still request info so we can show current config
        bluetoothService.sendCommand('info').catch(() => {});
        break;

      case 'setup_info': {
        const si = evt as SetupInfoEvent;
        setSetupInfo(si);
        setPhase('config_mode');
        // Initialise field states from current values
        const states: Record<string, FieldState> = {};
        for (const f of si.fields) {
          states[f.k] = { value: String(f.v), dirty: false, acking: false, error: '' };
        }
        setFieldStates(states);
        break;
      }

      case 'cfg_status':
        setCfgStatus(evt as CfgStatusEvent);
        break;

      case 'defaults_applied':
        // Firmware applied device defaults — request updated info
        bluetoothService.sendCommand('info').catch(() => {});
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
            [pendingAck]: { ...prev[pendingAck], acking: false, error: 'Unknown command' },
          }));
          setPendingAck(null);
        }
        break;

      case 'cfg_saved':
        setPhase('initing');
        bluetoothService.sendCommand('init').catch(() => {});
        break;

      case 'auto_init':
        setPhase('initing');
        break;

      case 'radio_ready':
        setCfgStatus(prev => prev ? { ...prev, radio_ok: true } : null);
        break;

      case 'radio_err': {
        const code = String(evt.code ?? '');
        const label = RADIO_ERR[code] ?? `code ${code}`;
        setRadioError(`Radio init failed: ${label}`);
        setPhase('error');
        break;
      }

      case 'config_done':
        // Config loop exited, wait for mesh_started
        break;

      case 'mesh_started':
        setNodeId(evt.nodeId);
        setMeshRunning(true);
        setPhase('done');
        if (onMeshStarted) onMeshStarted(evt.nodeId);
        break;

      case 'reconnected':
        // Auto-reconnect happened — re-request setup info
        bluetoothService.sendCommand('info').catch(() => {});
        break;
    }
  }

  // ── Field change handlers ──────────────────────────────────────────────────

  function handleFieldChange(key: string, value: string) {
    setFieldStates(prev => ({
      ...prev,
      [key]: { ...prev[key], value, dirty: true, error: '' },
    }));
  }

  function validateField(field: ConfigField, value: string): string {
    if (field.type === 'hex') {
      if (!/^0x[0-9A-Fa-f]{1,2}$/.test(value)) return 'Must be 0x00–0xFF';
    } else if (field.type === 'pin' || (field.min !== undefined && field.max !== undefined)) {
      const n = Number(value);
      if (isNaN(n)) return 'Must be a number';
      const min = field.type === 'pin' ? 0 : (field.min ?? 0);
      const max = field.type === 'pin' ? 39 : (field.max ?? Infinity);
      if (n < min || n > max) return `Must be ${min}–${max}`;
    }
    return '';
  }

  async function sendFieldSet(field: ConfigField) {
    const state = fieldStates[field.k];
    if (!state) return;
    const err = validateField(field, state.value);
    if (err) {
      setFieldStates(prev => ({ ...prev, [field.k]: { ...prev[field.k], error: err } }));
      return;
    }
    setFieldStates(prev => ({ ...prev, [field.k]: { ...prev[field.k], acking: true, error: '' } }));
    setPendingAck(field.k);
    try {
      await bluetoothService.sendCommand(`set ${field.k} ${state.value}`);
    } catch {
      setFieldStates(prev => ({ ...prev, [field.k]: { ...prev[field.k], acking: false, error: 'Send failed' } }));
      setPendingAck(null);
    }
  }

  async function handleDeviceSelect(value: string) {
    handleFieldChange('device', value);
    try {
      await bluetoothService.sendCommand(`device ${value}`);
    } catch {
      /* ignore */
    }
  }

  async function handleSave() {
    setPhase('saving');
    try {
      await bluetoothService.sendCommand('save');
    } catch {
      setPhase('config_mode');
    }
  }

  async function handleReboot() {
    if (window.confirm('Reboot the device?')) {
      await bluetoothService.sendCommand('reboot').catch(() => {});
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderField(field: ConfigField) {
    const state = fieldStates[field.k] ?? { value: String(field.v), dirty: false, acking: false, error: '' };
    const isDeviceField = field.k === 'device';

    const labelCls = 'block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1';
    const inputCls = `w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
      state.error ? 'border-red-400' : 'border-gray-300'
    } ${state.acking ? 'opacity-50' : ''}`;

    const unitLabel = field.unit ? (
      <span className="ml-2 text-xs text-gray-400">{field.unit}</span>
    ) : null;

    const ackSpinner = state.acking ? (
      <span className="ml-2 inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    ) : null;

    const ackDone = !state.acking && !state.dirty && !state.error && state.value !== String(field.v) ? (
      <span className="ml-2 text-green-600 text-xs">✓</span>
    ) : null;

    let input: React.ReactElement;

    if (field.opts) {
      const opts = field.opts.split('|');
      if (isDeviceField) {
        // Device selector triggers device command immediately
        input = (
          <select
            className={inputCls}
            value={state.value}
            onChange={e => handleDeviceSelect(e.target.value)}
            disabled={state.acking}
          >
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      } else if (opts.length <= 4) {
        // Segmented control for small option sets
        input = (
          <div className="flex rounded-md overflow-hidden border border-gray-300">
            {opts.map(o => (
              <button
                key={o}
                type="button"
                className={`flex-1 px-3 py-2 text-sm transition-colors ${
                  state.value === o
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                } ${state.acking ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={state.acking}
                onClick={() => {
                  handleFieldChange(field.k, o);
                  setFieldStates(prev => ({
                    ...prev,
                    [field.k]: { ...prev[field.k], value: o, dirty: true },
                  }));
                  // Auto-send for segmented controls
                  const updated = { ...field, v: o };
                  const s = { ...fieldStates[field.k], value: o, dirty: true, acking: true, error: '' };
                  setFieldStates(prev => ({ ...prev, [field.k]: s }));
                  setPendingAck(field.k);
                  bluetoothService.sendCommand(`set ${field.k} ${o}`).catch(() => {
                    setFieldStates(prev => ({ ...prev, [field.k]: { ...prev[field.k], acking: false, error: 'Send failed' } }));
                    setPendingAck(null);
                  });
                  // Suppress unused warning
                  void updated;
                }}
              >
                {o}
              </button>
            ))}
          </div>
        );
      } else {
        // Dropdown for larger sets
        input = (
          <select
            className={inputCls}
            value={state.value}
            disabled={state.acking}
            onChange={e => handleFieldChange(field.k, e.target.value)}
            onBlur={() => sendFieldSet(field)}
          >
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      }
    } else {
      input = (
        <input
          type={field.type === 'hex' ? 'text' : 'number'}
          className={inputCls}
          value={state.value}
          disabled={state.acking}
          min={field.type === 'pin' ? 0 : field.min}
          max={field.type === 'pin' ? 39 : field.max}
          step={field.unit === 'MHz' || field.unit === 'kHz' || field.unit === 'V' ? 'any' : 1}
          onChange={e => handleFieldChange(field.k, e.target.value)}
          onBlur={() => sendFieldSet(field)}
        />
      );
    }

    return (
      <div key={field.k} className="bg-white rounded-lg border border-gray-200 p-4">
        <div className={labelCls}>
          {field.k}
          {unitLabel}
          {ackSpinner}
          {ackDone}
        </div>
        {input}
        {state.error && (
          <p className="mt-1 text-xs text-red-600">{state.error}</p>
        )}
        {state.dirty && !state.acking && !isDeviceField && !field.opts && (
          <button
            type="button"
            onClick={() => sendFieldSet(field)}
            className="mt-2 text-xs text-blue-600 underline"
          >
            Apply
          </button>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (phase === 'done') {
    return (
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-400 text-green-800 rounded-lg p-6 text-center">
          <div className="text-3xl mb-2">✓</div>
          <p className="text-lg font-semibold">Configuration complete</p>
          {nodeId !== null && (
            <p className="mt-1 text-sm font-mono">Node ID: {nodeId}</p>
          )}
          <p className="mt-2 text-sm">Mesh is running.</p>
        </div>
        <button
          onClick={handleReboot}
          className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
        >
          Reboot device
        </button>
        <EventLog log={log} logEndRef={logEndRef} />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-400 text-red-800 rounded-lg p-4">
          <p className="font-semibold">Error</p>
          <p className="text-sm mt-1">{radioError ?? 'Unknown error'}</p>
        </div>
        <button
          onClick={() => { setPhase('config_mode'); setRadioError(null); }}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
        >
          Back to configuration
        </button>
        <EventLog log={log} logEndRef={logEndRef} />
      </div>
    );
  }

  if (!setupInfo || phase === 'idle') {
    return (
      <div className="space-y-4">
        <div className="flex items-center space-x-3 text-gray-500">
          <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Waiting for device setup info…</span>
        </div>
        <EventLog log={log} logEndRef={logEndRef} />
      </div>
    );
  }

  const isBusy = phase === 'saving' || phase === 'initing';

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="flex flex-wrap gap-3 text-xs font-mono">
        <span className={`px-2 py-1 rounded ${cfgStatus?.saved ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
          saved: {cfgStatus?.saved ? 'yes' : 'no'}
        </span>
        <span className={`px-2 py-1 rounded ${cfgStatus?.radio_ok ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
          radio: {cfgStatus?.radio_ok ? 'ok' : 'not ready'}
        </span>
        <span className="px-2 py-1 rounded bg-gray-100 text-gray-600">
          mesh: {meshRunning ? 'running' : 'stopped'}
        </span>
      </div>

      {/* Phase banners */}
      {phase === 'saving' && (
        <div className="flex items-center space-x-2 text-blue-700 bg-blue-50 border border-blue-200 rounded p-3 text-sm">
          <span className="inline-block w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span>Saving configuration…</span>
        </div>
      )}
      {phase === 'initing' && (
        <div className="flex items-center space-x-2 text-blue-700 bg-blue-50 border border-blue-200 rounded p-3 text-sm">
          <span className="inline-block w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span>Initialising radio…</span>
        </div>
      )}

      {/* Field grid */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Device Configuration</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {setupInfo.fields.map(f => renderField(f))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          disabled={isBusy}
          onClick={handleSave}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
        >
          Save to flash
        </button>
        <button
          disabled={isBusy || !cfgStatus?.saved}
          onClick={async () => {
            setPhase('initing');
            await bluetoothService.sendCommand('init').catch(() => setPhase('config_mode'));
          }}
          className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          title={!cfgStatus?.saved ? 'Save first' : ''}
        >
          Init radio
        </button>
        <button
          disabled={isBusy || !cfgStatus?.radio_ok}
          onClick={async () => {
            await bluetoothService.sendCommand('startmesh').catch(() => {});
          }}
          className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          title={!cfgStatus?.radio_ok ? 'Radio not ready' : ''}
        >
          Start mesh
        </button>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleReboot}
          disabled={isBusy}
          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 text-sm"
        >
          Reboot
        </button>
        <button
          onClick={async () => {
            if (window.confirm('Turning BT off will disconnect you. Continue?')) {
              await bluetoothService.sendCommand('bt off').catch(() => {});
            }
          }}
          disabled={isBusy}
          className="flex-1 px-4 py-2 bg-orange-100 text-orange-700 rounded-md hover:bg-orange-200 disabled:opacity-50 text-sm"
        >
          BT off
        </button>
      </div>

      {/* Event log */}
      <EventLog log={log} logEndRef={logEndRef} />
    </div>
  );
};

// ── Event log sub-component ────────────────────────────────────────────────

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
        className="text-xs text-gray-500 underline mb-2"
        onClick={() => setOpen(v => !v)}
      >
        {open ? 'Hide' : 'Show'} event log ({log.length})
      </button>
      {open && (
        <div className="bg-gray-900 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs">
          {log.map((evt, i) => (
            <div key={i} className="text-green-400 py-0.5 border-b border-gray-800 last:border-0">
              {JSON.stringify(evt)}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}
