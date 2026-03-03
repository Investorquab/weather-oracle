# 🌤 GenLayer Weather Oracle

On-chain weather data for any city, verified by GenLayer AI consensus.

**Live Demo:** https://weather-oracle.netlify.app  
**Contract:** deploy weather_oracle.py to GenLayer Studionet  

## Features
- Search any city worldwide
- Real weather from Open-Meteo API (free, no API key)
- AI consensus verification via GenLayer
- 5-day forecast
- On-chain weather history snapshots
- °C / °F toggle

## Contract Methods
- `get_weather(city)` — fetch & verify weather via AI consensus
- `record_weather(city)` — store snapshot on-chain permanently
- `get_weather_history(city)` — read stored snapshots
- `get_stats()` — oracle statistics

Built for the GenLayer contribution program.
