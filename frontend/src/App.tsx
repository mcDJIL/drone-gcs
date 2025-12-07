import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  BatteryCharging, 
  Compass, 
  Navigation, 
  Power, 
  Send, 
  Signal, 
  Wifi, 
  AlertTriangle,
  ArrowUp,
  Server,
  Cpu,
  Gamepad2,
  Anchor
} from 'lucide-react';

// --- STYLES ---
const styles = `
  /* Custom Scrollbar */
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-track { background: #1f2937; }
  ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #6b7280; }

  /* Artificial Horizon */
  .horizon-container {
    overflow: hidden;
    position: relative;
    border-radius: 50%;
    border: 4px solid #374151;
  }
  .horizon-sky {
    background: #3b82f6;
    width: 100%;
    height: 200%;
    position: absolute;
    top: -50%;
    transition: transform 0.1s linear;
  }
  .horizon-ground {
    background: #854d0e;
    width: 100%;
    height: 50%; 
    position: absolute;
    bottom: 0;
  }
  .hud-overlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  /* Map */
  #map-container {
    width: 100%;
    height: 100%;
    z-index: 0;
    background: #111827;
  }
  .leaflet-pane { z-index: 1 !important; }
  .leaflet-bottom { z-index: 10 !important; }
`;

// --- TYPES ---
interface TelemetryData {
  connected: boolean;
  armed: boolean;
  mode: string;
  battery_voltage: number;
  battery_remaining: number;
  latitude: number;
  longitude: number;
  altitude_relative: number;
  heading: number; 
  pitch: number; 
  roll: number; 
  satellites: number;
  ground_speed: number;
  climb_rate: number;
}

interface LogMessage {
  id: number;
  timestamp: string;
  type: string;
  message: string;
}

// --- MAIN COMPONENT ---
const App = () => {
  const [dataSource, setDataSource] = useState<'SIMULATION' | 'LIVE'>('SIMULATION');
  const [wsStatus, setWsStatus] = useState<string>('DISCONNECTED');

  const [telemetry, setTelemetry] = useState<TelemetryData>({
    connected: false,
    armed: false,
    mode: 'DISARMED',
    battery_voltage: 0,
    battery_remaining: 0,
    latitude: -6.2088, 
    longitude: 106.8456,
    altitude_relative: 0,
    heading: 0,
    pitch: 0,
    roll: 0,
    satellites: 0,
    ground_speed: 0,
    climb_rate: 0
  });

  const [logs, setLogs] = useState<LogMessage[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Refs
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const pathDataRef = useRef<[number, number][]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const addLog = (type: string, message: string) => {
    const now = new Date();
    setLogs(prev => [
      ...prev.slice(-49), 
      {
        id: Date.now(),
        timestamp: `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`,
        type,
        message
      }
    ]);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // --- 1. KEYBOARD CONTROL (WASD + SPACE) ---
  useEffect(() => {
    // Parameter Kecepatan
    const SPEED = 5.0; // m/s
    const YAW_SPEED = 40.0; // deg/s
    const CLIMB_SPEED = 2.0; // m/s

    const handleKeyDown = (e: KeyboardEvent) => {
      // Hanya aktif jika mode LIVE dan terhubung
      if (dataSource !== 'LIVE' || !wsRef.current) return;
      
      // Prevent scrolling page for arrows and space
      if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"," "].indexOf(e.key) > -1 || e.code === "Space") {
          e.preventDefault();
      }

      let x = 0, y = 0, z = 0, r = 0;

      // WASD = Gerak Datar (Body Frame)
      if (e.key === 'w' || e.key === 'W') x = SPEED;    // Maju
      if (e.key === 's' || e.key === 'S') x = -SPEED;   // Mundur
      if (e.key === 'a' || e.key === 'A') y = -SPEED;   // Kiri (Geser)
      if (e.key === 'd' || e.key === 'D') y = SPEED;    // Kanan (Geser)

      // Arrow Left/Right = Putar (Yaw)
      if (e.key === 'ArrowLeft') r = -YAW_SPEED;
      if (e.key === 'ArrowRight') r = YAW_SPEED;

      // Arrow Up/Down & Space = Altitude
      // Note: Di MAVLink NED, Z negatif = Naik (Up)
      if (e.key === 'ArrowUp') z = -CLIMB_SPEED;
      if (e.key === 'ArrowDown') z = CLIMB_SPEED;
      
      // Tombol SPASI untuk NAIK
      if (e.code === 'Space') z = -CLIMB_SPEED;

      if (x !== 0 || y !== 0 || z !== 0 || r !== 0) {
        const payload = { type: 'MANUAL_CONTROL', x, y, z, r };
        wsRef.current.send(JSON.stringify(payload));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
        if (dataSource !== 'LIVE' || !wsRef.current) return;
        // Stop movement on key release
        wsRef.current.send(JSON.stringify({ type: 'MANUAL_CONTROL', x: 0, y: 0, z: 0, r: 0 }));
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [dataSource]);


  // --- 2. INIT MAP ---
  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
        const link = document.createElement("link");
        link.id = 'leaflet-css';
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.7.1/dist/leaflet.css";
        document.head.appendChild(link);
    }
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    if (!document.getElementById('leaflet-js')) {
        const script = document.createElement("script");
        script.id = 'leaflet-js';
        script.src = "https://unpkg.com/leaflet@1.7.1/dist/leaflet.js";
        script.async = true;
        script.onload = () => initMapInstance();
        document.head.appendChild(script);
    } else {
        setTimeout(initMapInstance, 500);
    }

    return () => {
        if (mapRef.current) {
            mapRef.current.remove();
            mapRef.current = null;
        }
    };
  }, []);

  const initMapInstance = () => {
    const L = (window as any).L;
    if (!L || mapRef.current) return;

    const map = L.map('map-container', {
        zoomControl: false,
        attributionControl: false
    }).setView([-6.2088, 106.8456], 16);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

    const droneIcon = L.divIcon({
      html: `
      <div style="width: 40px; height: 40px; transform: translate(-50%, -50%);">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" 
              stroke="#ef4444" fill="none" stroke-width="4" 
              stroke-linecap="round" stroke-linejoin="round"
              style="filter: drop-shadow(0 0 4px #000);">
              
              <!-- Body -->
              <circle cx="32" cy="32" r="8"/>

              <!-- Arms -->
              <line x1="32" y1="10" x2="32" y2="24"/>
              <line x1="32" y1="40" x2="32" y2="54"/>
              <line x1="10" y1="32" x2="24" y2="32"/>
              <line x1="40" y1="32" x2="54" y2="32"/>

              <!-- Propellers -->
              <circle cx="32" cy="8" r="5"/>
              <circle cx="32" cy="56" r="5"/>
              <circle cx="8" cy="32" r="5"/>
              <circle cx="56" cy="32" r="5"/>
          </svg>
      </div>
      `,
      className: 'custom-drone-icon',
      iconSize: [40, 40],
      iconAnchor: [20, 20]
  });

    const marker = L.marker([-6.2088, 106.8456], { icon: droneIcon }).addTo(map);
    const polyline = L.polyline([], { color: 'red', weight: 2, opacity: 0.6 }).addTo(map);

    mapRef.current = map;
    markerRef.current = marker;
    polylineRef.current = polyline;
  };

  // --- 3. MAP UPDATES ---
  useEffect(() => {
    const L = (window as any).L;
    if (!L || !mapRef.current || !markerRef.current) return;

    const newLatLng = [telemetry.latitude, telemetry.longitude] as [number, number];
    markerRef.current.setLatLng(newLatLng);

    if (telemetry.connected) {
       mapRef.current.panTo(newLatLng, { animate: true, duration: 0.1 });
    }

    if (telemetry.armed) {
        pathDataRef.current.push(newLatLng);
        if (polylineRef.current) polylineRef.current.setLatLngs(pathDataRef.current);
    }
  }, [telemetry.latitude, telemetry.longitude]);


  // --- 4. DATA SOURCES ---
  useEffect(() => {
    // SIMULATION MODE LOGIC (IMPROVED)
    if (dataSource === 'SIMULATION') {
        let angle = 0;
        setTimeout(() => setTelemetry(p => ({...p, connected: true})), 1000);
        
        const interval = setInterval(() => {
            setTelemetry(prev => {
                if(!prev.connected) return prev;
                
                let { latitude, longitude, altitude_relative, ground_speed } = prev;
                let currentMode = prev.mode;

                if(prev.armed) {
                    // Logic Pergerakan Melingkar
                    angle += 0.05;
                    latitude = -6.2088 + Math.sin(angle) * 0.002;
                    longitude = 106.8456 + Math.cos(angle) * 0.002;
                    
                    // Logic Speed Simulasi
                    ground_speed = 5 + Math.random() * 2; // Speed variatif 5-7 m/s

                    // Logic Altitude Simulation
                    if (currentMode === 'TAKEOFF') {
                        // Naik pelan-pelan sampai 10m
                        if (altitude_relative < 10) altitude_relative += 0.5;
                    } else if (currentMode === 'LAND') {
                        // Turun pelan-pelan
                        if (altitude_relative > 0) altitude_relative -= 0.5;
                    } else {
                        // Di mode lain, pertahankan ketinggian (sedikit variasi)
                        if (altitude_relative < 1) altitude_relative = 2; // Min fly alt
                    }

                } else {
                    // Jika DISARMED
                    ground_speed = 0;
                    if (altitude_relative > 0) altitude_relative -= 0.5; // Jatuh/Turun ke tanah
                }

                // CLAMP Altitude (Simulasi tidak boleh minus)
                if (altitude_relative < 0) altitude_relative = 0;

                return {
                    ...prev,
                    latitude, longitude, altitude_relative, ground_speed,
                    battery_remaining: Math.max(0, prev.battery_remaining - 0.01),
                    battery_voltage: 11.0 + (prev.battery_remaining / 100) * 1.6,
                    pitch: Math.sin(Date.now()/1000)*5,
                    roll: Math.cos(Date.now()/1500)*5
                }
            });
        }, 100);
        return () => clearInterval(interval);
    }

    // LIVE WEBSOCKET MODE
    if (dataSource === 'LIVE') {
        const wsUrl = "ws://localhost:8080/telemetry";
        addLog('INFO', `Connecting to ${wsUrl}...`);
        setWsStatus('CONNECTING');
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            addLog('MAVLINK', 'WebSocket Connected');
            setWsStatus('CONNECTED');
            setTelemetry(t => ({ ...t, connected: true }));
        };
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                setTelemetry(prev => ({ ...prev, ...data }));
            } catch (e) {}
        };
        ws.onclose = () => {
            setWsStatus('DISCONNECTED');
            setTelemetry(t => ({ ...t, connected: false }));
        };
        wsRef.current = ws;
        return () => ws.close();
    }
  }, [dataSource]);

  // --- ACTIONS ---
  const sendCommand = (payload: any) => {
      if(dataSource === 'LIVE' && wsRef.current) {
          wsRef.current.send(JSON.stringify(payload));
      } else {
          addLog('INFO', 'Command ignored (Simulation Mode)');
      }
  };

  const handleArm = () => {
      if(dataSource === 'SIMULATION') {
          // Fake logic for Sim
          setTelemetry(t => ({...t, armed: !t.armed}));
          return;
      }
      
      // Hint log untuk user jika masih di Stabilize
      if (!telemetry.armed && telemetry.mode.includes("STABILIZE")) {
          addLog('WARN', 'Mode is STABILIZE. Switch to HOLD/LOITER first!');
      }

      const command = {
          type: 'COMMAND_LONG',
          command: 'MAV_CMD_COMPONENT_ARM_DISARM',
          param1: telemetry.armed ? 0 : 1
      };
      sendCommand(command);
  };

  const handleModeChange = (newMode: string) => {
      if(dataSource === 'SIMULATION') {
          setTelemetry(t => ({...t, mode: newMode}));
          return;
      }
      sendCommand({ type: 'SET_MODE', mode: newMode });
  };

  // --- UI COMPONENTS ---
  const ArtificialHorizon = ({ pitch, roll }: { pitch: number, roll: number }) => {
    const pitchOffset = pitch * 2; 
    return (
      <div className="w-48 h-48 mx-auto horizon-container bg-blue-500 shadow-lg mb-4">
        <div className="w-full h-full relative" style={{ transform: `rotate(${-roll}deg)` }}>
            <div className="horizon-sky" style={{ transform: `translateY(${pitchOffset}px)` }}>
                <div className="horizon-ground"></div>
            </div>
            <div className="absolute top-0 left-0 w-full h-full flex flex-col items-center justify-center opacity-50 text-white text-xs font-mono">
                <div className="border-b border-white w-12 mb-2">10</div>
                <div className="border-b border-white w-20 mb-2"></div>
                <div className="border-b border-white w-12">10</div>
            </div>
        </div>
        <div className="hud-overlay">
            <div className="w-16 h-1 bg-yellow-400 opacity-80" style={{clipPath: 'polygon(0 0, 40% 0, 50% 100%, 60% 0, 100% 0, 100% 100%, 0 100%)', height: '4px'}}></div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans overflow-hidden">
      {/* HEADER */}
      <header className="h-16 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4 shrink-0 shadow-md z-10">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg"><Send size={24} className="text-white" /></div>
          <div>
            <h1 className="font-bold text-lg tracking-wider text-white"><span className="text-blue-400">GCS</span></h1>
            <span className="text-xs text-gray-400">MAVLink Interface</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex bg-gray-900 rounded p-1 border border-gray-600">
             <button onClick={() => setDataSource('SIMULATION')} className={`px-3 py-1 text-xs font-bold rounded flex gap-2 ${dataSource === 'SIMULATION' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}><Cpu size={14}/> SIM</button>
             <button onClick={() => setDataSource('LIVE')} className={`px-3 py-1 text-xs font-bold rounded flex gap-2 ${dataSource === 'LIVE' ? 'bg-green-600 text-white' : 'text-gray-400'}`}><Server size={14}/> LIVE</button>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold ${telemetry.connected ? 'bg-green-900/50 text-green-400 border border-green-700' : 'bg-red-900/50 text-red-400 border border-red-700'}`}>
            <Wifi size={16} /> {dataSource === 'LIVE' && !telemetry.connected ? wsStatus : (telemetry.connected ? 'CONNECTED' : 'DISCONNECTED')}
          </div>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold ${telemetry.armed ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-700 text-gray-300'}`}>
            <Power size={16} /> {telemetry.armed ? 'ARMED' : 'DISARMED'}
          </div>
          <div className="flex items-center gap-2">
             <BatteryCharging size={20} className={telemetry.battery_remaining < 20 ? 'text-red-500' : 'text-green-500'} />
             <div className="flex flex-col items-end leading-none">
               <span className="text-lg font-mono font-bold">{telemetry.battery_voltage.toFixed(1)}V</span>
               <span className="text-xs text-gray-400">{Math.round(telemetry.battery_remaining)}%</span>
             </div>
          </div>
        </div>
      </header>

      {/* CONTENT */}
      <div className="flex flex-1 overflow-hidden">
        {/* SIDEBAR */}
        <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col p-4 gap-4 overflow-y-auto z-20 shadow-xl">
          <div className="bg-gray-700/50 p-4 rounded-xl border border-gray-600">
            <h2 className="text-gray-400 text-xs font-bold uppercase mb-3 flex items-center gap-2"><Navigation size={14}/> Flight Mode</h2>
            <div className="grid grid-cols-1 gap-2">
               <div className="text-2xl font-black text-center bg-gray-900 py-3 rounded text-blue-400 mb-2 border border-blue-500/30">{telemetry.mode.replace('FlightMode.', '')}</div>
               
               {/* NEW BUTTON FOR SAFE TAKEOFF */}
               <button onClick={() => handleModeChange('HOLD')} className="btn-mode text-blue-300 border-blue-500/30 flex items-center justify-center gap-2">
                 <Anchor size={16}/> LOITER / HOLD
               </button>

               <button onClick={() => handleModeChange('TAKEOFF')} className="btn-mode">TAKEOFF</button>
               <button onClick={() => handleModeChange('LAND')} className="btn-mode">LAND</button>
               <button onClick={() => handleModeChange('RTL')} className="btn-mode text-yellow-400 border-yellow-400/30 hover:bg-yellow-900/30">RTL</button>
               
               <div className="h-px bg-gray-600 my-2"></div>
               
               <button onClick={() => handleModeChange('OFFBOARD')} className="btn-mode text-blue-400 border-blue-400/30 hover:bg-blue-900/30 flex items-center justify-center gap-2">
                 <Gamepad2 size={16}/> OFFBOARD (WASD)
               </button>
            </div>
            <div className="mt-3 text-[10px] text-gray-400 bg-black/20 p-2 rounded">
                <strong>Tips:</strong> For Auto Takeoff:<br/>
                1. Click <strong>LOITER / HOLD</strong><br/>
                2. Click <strong>ARM</strong><br/>
                3. Click <strong>TAKEOFF</strong>
            </div>
          </div>

          <div className="bg-gray-700/50 p-4 rounded-xl border border-gray-600">
             <h2 className="text-gray-400 text-xs font-bold uppercase mb-3 flex items-center gap-2"><AlertTriangle size={14}/> Actions</h2>
             <button onClick={handleArm} className={`w-full py-4 rounded-lg font-bold text-lg tracking-widest transition-all ${telemetry.armed ? 'bg-red-600 hover:bg-red-700 shadow-lg shadow-red-900/50' : 'bg-green-600 hover:bg-green-700 shadow-lg shadow-green-900/50'}`}>
                {telemetry.armed ? 'DISARM' : 'ARM'}
             </button>
          </div>
          
          <div className="flex-1"></div>
          
          {dataSource === 'LIVE' && (
             <div className="bg-blue-900/30 border border-blue-500/30 p-2 rounded text-[10px] text-blue-200">
                <p><strong>CONTROLS (OFFBOARD):</strong></p>
                <p>WASD: Move Horizontal</p>
                <p>Arrows: Yaw & Altitude</p>
                <p>Space: Fly Up (Throttle)</p>
             </div>
          )}
        </div>

        {/* MAP */}
        <div className="flex-1 bg-gray-900 relative">
          <div id="map-container"></div>
          <div className="absolute bottom-4 left-4 z-[1000] bg-gray-900/80 backdrop-blur p-2 rounded border border-gray-600 text-xs font-mono text-white pointer-events-none">
                <div>LAT: {telemetry.latitude.toFixed(6)}</div>
                <div>LNG: {telemetry.longitude.toFixed(6)}</div>
                <div className="mt-1 text-gray-400">SRC: {dataSource}</div>
          </div>
        </div>

        {/* INSTRUMENTS */}
        <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col overflow-y-auto z-20 shadow-xl">
            <div className="p-6 border-b border-gray-700 flex flex-col items-center">
                <h3 className="text-gray-400 text-xs font-bold uppercase mb-4 w-full text-left">Artificial Horizon</h3>
                <ArtificialHorizon pitch={telemetry.pitch} roll={telemetry.roll} />
                <div className="flex w-full justify-between px-2 font-mono text-sm">
                    <div className="text-blue-400 text-center"><span className="text-xs text-gray-500 block">PITCH</span>{telemetry.pitch.toFixed(1)}°</div>
                    <div className="text-green-400 text-center"><span className="text-xs text-gray-500 block">ROLL</span>{telemetry.roll.toFixed(1)}°</div>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-gray-700 border-b border-gray-700">
                {/* FIX: ADD Math.max(0, ...) to Altitude Display */}
                <div className="bg-gray-800 p-4 flex flex-col items-center"><ArrowUp size={20} className="text-blue-400 mb-1" /><span className="text-2xl font-mono font-bold">{Math.max(0, telemetry.altitude_relative).toFixed(1)}</span><span className="text-xs text-gray-500">ALT (m)</span></div>
                <div className="bg-gray-800 p-4 flex flex-col items-center"><Activity size={20} className="text-yellow-400 mb-1" /><span className="text-2xl font-mono font-bold">{telemetry.ground_speed.toFixed(1)}</span><span className="text-xs text-gray-500">SPEED (m/s)</span></div>
                <div className="bg-gray-800 p-4 flex flex-col items-center"><Compass size={20} className="text-red-400 mb-1" /><span className="text-2xl font-mono font-bold">{telemetry.heading.toFixed(0)}°</span><span className="text-xs text-gray-500">HEADING</span></div>
                <div className="bg-gray-800 p-4 flex flex-col items-center"><Signal size={20} className="text-green-400 mb-1" /><span className="text-2xl font-mono font-bold">{telemetry.satellites}</span><span className="text-xs text-gray-500">SATS</span></div>
            </div>
            <div className="flex-1 flex flex-col min-h-0 bg-black">
                <div className="bg-gray-700 px-3 py-1 text-xs font-bold text-gray-300 flex justify-between items-center"><span>CONSOLE</span><span className="bg-green-500 w-2 h-2 rounded-full animate-pulse"></span></div>
                <div className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-1">
                    {logs.map((log) => (
                        <div key={log.id} className="border-b border-gray-800/50 pb-1">
                            <span className="text-gray-500">[{log.timestamp}]</span> <span className="text-blue-400">{log.type}:</span> <span className="text-gray-400">{log.message}</span>
                        </div>
                    ))}
                    <div ref={logsEndRef} />
                </div>
            </div>
        </div>
      </div>
      <style>{`.btn-mode { @apply w-full py-2 bg-gray-700 border border-gray-600 rounded text-sm font-semibold text-gray-300 transition-colors hover:bg-gray-600 hover:text-white active:bg-gray-500; }`}</style>
    </div>
  );
};

export default App;