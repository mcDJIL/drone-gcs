# 🚁 **Ground Control Station**  
Modern Web-based Ground Control Station untuk Drone MAVLink (ArduPilot / PX4)

Skynet GCS adalah aplikasi *Ground Control Station* berbasis web yang dirancang untuk memonitor dan mengendalikan drone melalui protokol **MAVLink**. Dibangun dengan arsitektur **Decoupled**, aplikasi ini memisahkan Frontend dan Backend sehingga fleksibel, scalable, dan mudah dikembangkan.

---

## ✨ Fitur Utama

### 📡 Real-time Telemetry
- Altitude  
- Speed  
- Heading  
- Battery  
- GPS Position  

### 🗺️ Live Map (Leaflet – Dark Mode)
- Pelacakan posisi drone secara real-time  
- Custom icon drone  
- Smooth marker rotation  

### 🛩️ HUD / Artificial Horizon
- Menampilkan Pitch & Roll secara real-time

### 🔀 Dual Mode
| Mode | Deskripsi |
|------|-----------|
| **Simulation Mode** | Frontend berjalan tanpa backend (dummy data bawaan). |
| **Live Mode** | Terhubung ke drone asli atau SITL melalui WebSocket. |

### 🎮 Keyboard Offboard Control
Kendalikan drone seperti game menggunakan WASD.

### ⚠️ Failsafe Frontend
Ketika backend tidak mengirim groundspeed, frontend menghitung kecepatan manual berdasarkan perubahan GPS.

---

## 🛠️ Teknologi yang Digunakan

### **Frontend**
- React + TypeScript (Vite)
- Tailwind CSS
- Leaflet & React-Leaflet
- Lucide React Icons

### **Backend**
- Python 3.9+
- MAVSDK
- Websockets  
- Asyncio  

---

## ⚙️ Instalasi & Persiapan

### **1. Setup Backend (Python)**  
Masuk ke folder `backend/`:

```bash
pip install mavsdk websockets asyncio
```

### **2. Setup Frontend (React + Vite)**  
Masuk ke folder `frontend/`:

```bash
npm install
npm run dev
```

---

## 🚀 Cara Menjalankan

### **1. Jalankan Backend**
Pastikan SITL atau drone sudah aktif.

```bash
python gcs_backend.py
```

Jika berhasil, akan muncul:

```
WebSocket Server berjalan di ws://localhost:8080
```

### **2. Jalankan Frontend**
Buka browser:

➡️ http://localhost:5173

Lalu lakukan urutan berikut:

1. Klik **LIVE**  
2. Status berubah menjadi **CONNECTED**  
3. Klik **LOITER / HOLD**  
4. Klik **ARM**  
5. Klik **TAKEOFF**  
6. Klik **OFFBOARD (WASD)** untuk kontrol manual

---

## 🎮 Kontrol Keyboard (Mode Offboard)

| Tombol | Fungsi | Arah |
|--------|--------|--------|
| **W** | Maju | Forward |
| **S** | Mundur | Backward |
| **A** | Geser kiri | Left |
| **D** | Geser kanan | Right |
| **Space** | Naik | Throttle Up |
| **↑** | Naik | Altitude Up |
| **↓** | Turun | Altitude Down |
| **←** | Putar kiri | Yaw Left |
| **→** | Putar kanan | Yaw Right |

---

## 🔌 Cara Menghubungkan ke Drone Asli

### Perangkat yang Dibutuhkan
- Flight Controller (Pixhawk, Cube, Durandal, dll)  
- Firmware ArduPilot atau PX4  
- Telemetry Radio (SiK 433/915 MHz)

### Konfigurasi Backend

Edit file **gcs_backend.py**:

```python
# --- KONFIGURASI KONEKSI ---

# OPSI 1: SITL / WiFi Drone
# CONNECTION_STRING = "udp://:14550"

# OPSI 2: Telemetry USB (Windows)
CONNECTION_STRING = "serial://COM3:57600"

# OPSI 3: Telemetry USB (Linux/Mac)
# CONNECTION_STRING = "serial:///dev/ttyUSB0:57600"
```

---

## 🐛 Troubleshooting

### 1️⃣ Drone Auto-Disarm setelah Arm  
**Penyebab:** Mode STABILIZE butuh input throttle manual.  
**Solusi:** Gunakan mode **LOITER / HOLD** sebelum Arm.

### 2️⃣ Speed selalu 0  
**Penyebab:** Backend tidak mengirim metrics speed.  
**Solusi:** Frontend sudah ada fallback speed dari perubahan GPS.

### 3️⃣ Peta tidak muncul  
Pastikan koneksi internet aktif agar tiles OpenStreetMap/CartoDB dapat dimuat.

---

## 📝 Lisensi
Proyek ini dibuat untuk keperluan edukasi dan riset pembuatan GCS mandiri. Bebas untuk dimodifikasi.