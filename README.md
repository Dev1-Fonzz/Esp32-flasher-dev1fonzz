# ⚡ ESP32 WebFlasher

Web-based firmware flasher untuk ESP32-WROOM-32U.  
Upload `.zip` atau `.bin` terus dari browser — tanpa install Arduino IDE.

## Features

| Feature | Status |
|---|---|
| Upload `.zip` → auto extract `.bin` | ✅ |
| Upload `.bin` direct | ✅ |
| Web Serial API (Chrome/Edge) | ✅ |
| OTG USB Android | ✅ |
| Serial Monitor dengan terminal | ✅ |
| Send command ke device | ✅ |
| Progress bar semasa flash | ✅ |
| Flash offset, baud rate, erase flash | ✅ |
| Deploy Vercel + GitHub Actions | ✅ |

## Quick Start

```bash
npm install
npm run dev
```

Buka `http://localhost:5173`

## Deploy ke Vercel

1. Push ke GitHub
2. Connect repo kat Vercel
3. Vercel auto-detect Vite — tekan Deploy

### GitHub Secrets untuk CI/CD
```
VERCEL_TOKEN    → dari vercel.com/account/tokens
ORG_ID          → dari Vercel project settings
PROJECT_ID      → dari Vercel project settings
```

## OTG USB (Android)

1. Enable USB OTG dalam Android settings
2. Sambung ESP32 via OTG cable
3. Buka Chrome Android
4. Pergi ke website, tekan "Connect Device"
5. Pilih port USB

## Cara Guna

### Flash dari ZIP
1. Tekan drop zone atau "Open ZIP"
2. Pilih `.zip` yang ada `.bin` di dalamnya
3. App auto-pilih `.bin` jika hanya satu
4. Tekan "Connect Device" → pilih COM/USB port
5. Tekan "Flash Firmware"

### Flash dari BIN direct
1. Drop `.bin` ke drop zone
2. Set flash offset (default: `0x10000`)
3. Connect → Flash

### Serial Monitor
1. Connect device
2. Pergi tab "Monitor"
3. Tekan "Start Monitor"
4. Type command, Enter untuk send

## Stack

- React 18 + Vite
- Web Serial API
- JSZip
- Vercel hosting

## Browser Support

| Browser | Web Serial | OTG |
|---|---|---|
| Chrome 89+ | ✅ | ✅ |
| Edge 89+ | ✅ | ✅ |
| Firefox | ❌ | ❌ |
| Safari | ❌ | ❌ |

> Web Serial API hanya available di Chromium-based browsers.
