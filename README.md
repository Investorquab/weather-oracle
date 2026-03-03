# 🌤 GenLayer Weather Oracle

An on-chain weather data oracle built on [GenLayer](https://genlayer.com). Real-time weather for any city worldwide, verified by AI consensus across multiple validators.

**Live Demo:** [weather-oracle.netlify.app](https://weather-oracle.netlify.app)
**Backend:** [weather-oracle-production.up.railway.app](https://weather-oracle-production.up.railway.app/health)
**Contract:** `0x59D9D2c4920527CE1337b82C9fDC5e776e2615A3` on GenLayer Studionet
**GitHub:** [github.com/Investorquab/weather-oracle](https://github.com/Investorquab/weather-oracle)

---

## What It Does

- Fetches real-time weather for any city on earth via AI-powered GenLayer smart contracts
- Weather data verified by consensus across multiple AI validators (Claude, GPT, Llama, etc.)
- Records weather snapshots permanently on-chain for historical tracking
- Live data sourced from Open-Meteo API (free, no API key required)
- Clean modern UI with 5-day forecast, °C/°F toggle, humidity, wind, UV index

## GenLayer Features Used

| Feature | Usage |
|---|---|
| `gl.nondet.exec_prompt()` | AI validators independently estimate weather conditions |
| `gl.eq_principle.strict_eq()` | Multiple validators must agree before result is accepted |
| On-chain storage | Weather snapshots stored permanently in `TreeMap` |
| GenLayer Consensus | Weather data verified across multiple AI models |

## Contract Methods

| Method | Type | Description |
|---|---|---|
| `get_weather(city)` | write | Fetch & verify weather via AI consensus |
| `record_weather(city)` | write | Fetch + store snapshot on-chain permanently |
| `get_weather_history(city)` | view | Read stored weather snapshots |
| `get_tracked_cities()` | view | List all tracked cities |
| `get_stats()` | view | Oracle statistics |

## Tech Stack

- **Smart Contract:** Python on GenLayer Studionet
- **Backend:** Node.js + Express + genlayer-js
- **Frontend:** Vanilla HTML/CSS/JS — clean minimal design
- **Live Weather:** Open-Meteo API (free, no API key, global coverage)
- **Deployment:** Railway (backend) + Netlify (frontend)

## Local Setup

### 1. Deploy Contract
Open [studio.genlayer.com](https://studio.genlayer.com) → create new contract → paste `weather_oracle.py` → deploy → copy contract address.

### 2. Start Backend
```bash
npm install
OPERATOR_PRIVATE_KEY=your_key CONTRACT_ADDRESS=your_ca node server.js
```

### 3. Open Frontend
Open `index.html` in browser → paste contract address → search any city.

## Environment Variables

```env
OPERATOR_PRIVATE_KEY=0x...   # Your GenLayer operator wallet private key
CONTRACT_ADDRESS=0x...        # Deployed weather oracle contract address
PORT=3003
```

## Supported Cities

Any city worldwide — uses Open-Meteo geocoding to resolve city names to coordinates automatically. Examples: Lagos, London, Tokyo, New York, Dubai, Sydney, Paris, Mumbai, São Paulo, Cairo and more.

---

Built for the [GenLayer Mini-games & Tools](https://genlayer.com) contribution program.
Deployer wallet: `0xcD7f401774D579B16CEBc5e52550E245d6D88420`
