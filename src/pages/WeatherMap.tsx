import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { bluetoothService } from '../services/bluetoothService';
import { serialService } from '../services/serialService';
import type { BluetoothEvent } from '../types/bluetooth';

// Fix Leaflet default marker icon issue in bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// ── Weather station data model ───────────────────────────────────────────────

export interface WeatherStation {
  nodeId: string;
  lat: number;
  lon: number;
  tempC?: number;
  humidity?: number;
  pressureHPa?: number;
  hops?: number;
  lastUpdate: Date;
}

/** Parse the firmware weather data string, e.g.
 * "#MESH_WX_DATA:node=0xABCD,tempC=21.5,hum=48.0,hPa=1012.8,lat=51.123456,lon=7.567890"
 */
function parseWeatherData(from: string, data: string): WeatherStation | null {
  const kv: Record<string, string> = {};
  // Strip leading control prefix if present
  const body = data.replace(/^#MESH_WX_DATA:?/, '');
  body.split(',').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) kv[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  });

  const lat = parseFloat(kv['lat'] ?? '');
  const lon = parseFloat(kv['lon'] ?? '');
  if (isNaN(lat) || isNaN(lon)) return null; // no location → skip

  return {
    nodeId: kv['node']?.replace(/^0x/i, '').toLowerCase() || from,
    lat,
    lon,
    tempC: kv['tempC'] !== undefined ? parseFloat(kv['tempC']) : undefined,
    humidity: kv['hum'] !== undefined ? parseFloat(kv['hum']) : undefined,
    pressureHPa: kv['hPa'] !== undefined ? parseFloat(kv['hPa']) : undefined,
    lastUpdate: new Date(),
  };
}

// ── Colours for markers depending on age ─────────────────────────────────────

function stationMarkerIcon(ageSec: number): L.Icon {
  const colour = ageSec < 120 ? '#22c55e' : ageSec < 600 ? '#eab308' : '#ef4444';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="42" viewBox="0 0 28 42">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 28 14 28s14-17.5 14-28C28 6.27 21.73 0 14 0z" fill="${colour}"/>
    <circle cx="14" cy="14" r="7" fill="white"/>
  </svg>`;
  return L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(svg)}`,
    iconSize: [28, 42],
    iconAnchor: [14, 42],
    popupAnchor: [0, -36],
  });
}

// ── LS persistence so stations survive refresh ───────────────────────────────

const LS_STATIONS = 'meshWeatherStations';

function loadStations(): Map<string, WeatherStation> {
  try {
    const raw = localStorage.getItem(LS_STATIONS);
    if (!raw) return new Map();
    const arr: WeatherStation[] = JSON.parse(raw);
    const map = new Map<string, WeatherStation>();
    arr.forEach(s => {
      s.lastUpdate = new Date(s.lastUpdate);
      map.set(s.nodeId, s);
    });
    return map;
  } catch {
    return new Map();
  }
}

function saveStations(map: Map<string, WeatherStation>): void {
  localStorage.setItem(LS_STATIONS, JSON.stringify([...map.values()]));
}

// ── Component ────────────────────────────────────────────────────────────────

export const WeatherMap = () => {
  const [stations, setStations] = useState<Map<string, WeatherStation>>(loadStations);
  const stationsRef = useRef(stations);
  const connectionType = localStorage.getItem('connectionType');
  const commandService = connectionType === 'usb' ? serialService : bluetoothService;
  const [statusInfo, setStatusInfo] = useState('');

  useEffect(() => {
    stationsRef.current = stations;
  }, [stations]);

  // Listen for weather events
  useEffect(() => {
    const removeEvent = commandService.addEventListener((event: BluetoothEvent) => {
      if (event.evt === 'weather_rx') {
        const parsed = parseWeatherData(
          String(event.from ?? ''),
          String(event.data ?? ''),
        );
        if (parsed) {
          parsed.hops = event.hops ?? undefined;
          setStations(prev => {
            const next = new Map(prev);
            next.set(parsed.nodeId, parsed);
            saveStations(next);
            return next;
          });
          setStatusInfo(`Wetterdaten von Node 0x${parsed.nodeId} empfangen`);
        }
      }

      // Also catch msg_rx that contains weather data
      if (event.evt === 'msg_rx') {
        const raw = String(event.data ?? '');
        if (raw.includes('#MESH_WX_DATA')) {
          const parsed = parseWeatherData(
            String(event.from ?? ''),
            raw,
          );
          if (parsed) {
            parsed.hops = event.hops ?? undefined;
            setStations(prev => {
              const next = new Map(prev);
              next.set(parsed.nodeId, parsed);
              saveStations(next);
              return next;
            });
          }
        }
      }
    });

    return () => { removeEvent(); };
  }, [commandService]);

  const handleRequestWeather = async () => {
    try {
      await commandService.sendCommand('/wxreq all');
      setStatusInfo('Wetterdaten-Anfrage gesendet…');
    } catch (err) {
      setStatusInfo(`Fehler: ${(err as Error).message}`);
    }
  };

  const handleClearStations = () => {
    setStations(new Map());
    localStorage.removeItem(LS_STATIONS);
    setStatusInfo('Stationsdaten gelöscht');
  };

  const stationList = [...stations.values()].sort(
    (a, b) => b.lastUpdate.getTime() - a.lastUpdate.getTime(),
  );
  const now = Date.now();

  // Default center: Germany
  const defaultCenter: [number, number] = stationList.length > 0
    ? [stationList[0].lat, stationList[0].lon]
    : [51.1657, 10.4515];

  return (
    <div className="flex h-screen flex-col bg-gray-800">
      {/* Header */}
      <header className="bg-gray-900 shadow">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-100">MegaMesh Wetterkarte</h1>
              {statusInfo && <p className="mt-1 text-xs text-primary-700">{statusInfo}</p>}
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleRequestWeather}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Wetterdaten anfragen
              </button>
              <button
                onClick={handleClearStations}
                className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-600"
              >
                Zurücksetzen
              </button>
              <Link
                to="/messages"
                className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-600"
              >
                ← Nachrichten
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Body: Map + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="flex-1">
          <MapContainer
            center={defaultCenter}
            zoom={6}
            className="h-full w-full"
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {stationList.map(station => {
              const ageSec = (now - station.lastUpdate.getTime()) / 1000;
              return (
                <Marker
                  key={station.nodeId}
                  position={[station.lat, station.lon]}
                  icon={stationMarkerIcon(ageSec)}
                >
                  <Popup>
                    <div className="min-w-[180px] text-sm">
                      <p className="font-bold">Node 0x{station.nodeId}</p>
                      {station.tempC !== undefined && (
                        <p>🌡️ Temperatur: {station.tempC.toFixed(1)} °C</p>
                      )}
                      {station.humidity !== undefined && (
                        <p>💧 Luftfeuchtigkeit: {station.humidity.toFixed(1)} %</p>
                      )}
                      {station.pressureHPa !== undefined && (
                        <p>🔵 Luftdruck: {station.pressureHPa.toFixed(1)} hPa</p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">
                        📍 {station.lat.toFixed(5)}, {station.lon.toFixed(5)}
                      </p>
                      {station.hops !== undefined && (
                        <p className="text-xs text-gray-500">Hops: {station.hops}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        Zuletzt: {station.lastUpdate.toLocaleTimeString('de-DE')}
                      </p>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>

        {/* Sidebar: station list */}
        <div className="w-80 overflow-y-auto border-l border-gray-700 bg-gray-900 shadow-lg">
          <div className="border-b border-gray-700 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-200">
              Wetterstationen ({stationList.length})
            </h2>
          </div>
          {stationList.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              Noch keine Wetterstationen empfangen.<br />
              Klicke auf "Wetterdaten anfragen", um Stationen zu suchen.
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {stationList.map(station => {
                const ageSec = Math.floor((now - station.lastUpdate.getTime()) / 1000);
                return (
                  <div key={station.nodeId} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-medium text-gray-100">
                        0x{station.nodeId}
                      </span>
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          ageSec < 120
                            ? 'bg-green-500'
                            : ageSec < 600
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                        }`}
                      />
                    </div>
                    {station.tempC !== undefined && (
                      <p className="text-xs text-gray-400">
                        🌡️ {station.tempC.toFixed(1)} °C
                        {station.humidity !== undefined && ` · 💧 ${station.humidity.toFixed(0)}%`}
                      </p>
                    )}
                    {station.pressureHPa !== undefined && (
                      <p className="text-xs text-gray-400">
                        🔵 {station.pressureHPa.toFixed(1)} hPa
                      </p>
                    )}
                    <p className="text-[10px] text-gray-500">
                      📍 {station.lat.toFixed(4)}, {station.lon.toFixed(4)} · vor {ageSec}s
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
