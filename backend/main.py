import asyncio
import json
import websockets
from mavsdk import System
from mavsdk.offboard import (OffboardError, VelocityBodyYawspeed, PositionNedYaw)

# --- KONFIGURASI KONEKSI ---
# Pilih salah satu (Uncomment yang sesuai)

# 1. Simulator (SITL) atau WiFi
CONNECTION_STRING = "udp://:14550" 

# 2. USB Telemetry (Windows - Cek Device Manager)
# CONNECTION_STRING = "serial://COM3:57600"

# 3. USB Telemetry (Linux/Mac)
# CONNECTION_STRING = "serial:///dev/ttyUSB0:57600"

WS_PORT = 8080

# State Global
current_telemetry = {
    "connected": False,
    "armed": False,
    "mode": "UNKNOWN",
    "battery_voltage": 0,
    "battery_remaining": 0,
    "latitude": 0,
    "longitude": 0,
    "altitude_relative": 0,
    "heading": 0,
    "pitch": 0,
    "roll": 0,
    "satellites": 0,
    "ground_speed": 0,
    "climb_rate": 0
}

connected_clients = set()
drone_system = None

async def telemetry_loop():
    """Mengambil data dari Drone secara paralel"""
    global drone_system
    
    async def get_position():
        async for position in drone_system.telemetry.position():
            current_telemetry["latitude"] = position.latitude_deg
            current_telemetry["longitude"] = position.longitude_deg
            current_telemetry["altitude_relative"] = position.relative_altitude_m

    async def get_attitude():
        async for attitude in drone_system.telemetry.attitude_euler():
            current_telemetry["roll"] = attitude.roll_deg
            current_telemetry["pitch"] = attitude.pitch_deg
            current_telemetry["heading"] = attitude.yaw_deg

    async def get_battery():
        async for battery in drone_system.telemetry.battery():
            current_telemetry["battery_voltage"] = battery.voltage_v
            current_telemetry["battery_remaining"] = battery.remaining_percent * 100

    async def get_flight_mode():
        async for mode in drone_system.telemetry.flight_mode():
            current_telemetry["mode"] = str(mode)

    async def get_armed():
        async for is_armed in drone_system.telemetry.armed():
            current_telemetry["armed"] = is_armed

    async def get_gps_info():
        async for gps_info in drone_system.telemetry.gps_info():
            current_telemetry["satellites"] = gps_info.num_satellites

    async def get_metrics():
         async for metrics in drone_system.telemetry.fixedwing_metrics():
             current_telemetry["ground_speed"] = metrics.groundspeed_m_s
             current_telemetry["climb_rate"] = metrics.climb_rate_m_s

    # Jalankan listener (gunakan try-except agar robust)
    try:
        await asyncio.gather(
            get_position(),
            get_attitude(),
            get_battery(),
            get_flight_mode(),
            get_armed(),
            get_gps_info(),
            get_metrics()
        )
    except Exception as e:
        print(f"Telemetry Error: {e}")

async def broadcast_loop():
    """Broadcast data ke React Frontend (10Hz)"""
    while True:
        if connected_clients:
            try:
                # Tambahkan timestamp
                data = current_telemetry.copy()
                message = json.dumps(data)
                await asyncio.gather(*[client.send(message) for client in connected_clients])
            except Exception as e:
                print(f"Broadcast Error: {e}")
        await asyncio.sleep(0.1)

async def websocket_handler(websocket):
    """Handle Perintah dari Frontend"""
    connected_clients.add(websocket)
    print(">>> React Client Terhubung")
    
    try:
        async for message in websocket:
            data = json.loads(message)
            
            # --- 1. ARM / DISARM ---
            if data.get('type') == 'COMMAND_LONG':
                if data['command'] == 'MAV_CMD_COMPONENT_ARM_DISARM':
                    should_arm = data['param1'] == 1
                    try:
                        if should_arm:
                            print("CMD: Arming...")
                            await drone_system.action.arm()
                        else:
                            print("CMD: Disarming...")
                            await drone_system.action.disarm()
                    except Exception as e:
                        print(f"Gagal Arm/Disarm: {e}")

            # --- 2. GANTI MODE ---
            elif data.get('type') == 'SET_MODE':
                mode = data['mode']
                print(f"CMD: Set Mode -> {mode}")
                try:
                    if mode == 'OFFBOARD':
                        # Setpoint awal (diam) wajib dikirim sebelum start offboard
                        print("Setting initial setpoint...")
                        await drone_system.offboard.set_velocity_body(
                            VelocityBodyYawspeed(0.0, 0.0, 0.0, 0.0)
                        )
                        try:
                            await drone_system.offboard.start()
                            print("OFFBOARD STARTED!")
                        except OffboardError as error:
                            print(f"Offboard start failed: {error}")
                            
                    elif mode == 'RTL':
                        await drone_system.action.return_to_launch()
                    elif mode == 'TAKEOFF':
                        await drone_system.action.takeoff()
                    elif mode == 'LAND':
                        await drone_system.action.land()
                    elif mode == 'HOLD':
                        await drone_system.action.hold()
                except Exception as e:
                    print(f"Mode Change Error: {e}")

            # --- 3. KONTROL MANUAL (WASD) ---
            elif data.get('type') == 'MANUAL_CONTROL':
                # Hanya proses jika di mode OFFBOARD (agar aman)
                # Namun untuk testing SITL, kita bisa langsung kirim
                try:
                    await drone_system.offboard.set_velocity_body(
                        VelocityBodyYawspeed(
                            float(data['x']), 
                            float(data['y']), 
                            float(data['z']), 
                            float(data['r'])
                        )
                    )
                except Exception as e:
                    pass # Ignore error spam jika belum offboard

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.remove(websocket)
        print("<<< React Client Terputus")

async def main():
    global drone_system
    drone_system = System()
    
    print(f"--- SKYNET GCS BACKEND ---")
    print(f"Menunggu Drone di: {CONNECTION_STRING}...")
    
    # Connect ke Drone
    await drone_system.connect(system_address=CONNECTION_STRING)

    # Tunggu Heartbeat
    print("Menunggu Heartbeat...")
    async for state in drone_system.core.connection_state():
        if state.is_connected:
            print(f"*** DRONE TERHUBUNG! ***")
            current_telemetry["connected"] = True
            break

    # Jalankan Server WebSocket
    server = await websockets.serve(websocket_handler, "localhost", WS_PORT)
    print(f"WebSocket Server berjalan di ws://localhost:{WS_PORT}")

    # Jalankan semua loop
    await asyncio.gather(
        telemetry_loop(),
        broadcast_loop(),
        server.wait_closed()
    )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer Berhenti.")