import express from 'express';
import cors from 'cors';
import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const OPERATOR_KEY     = process.env.OPERATOR_PRIVATE_KEY || '0xa7db0893b5433f384c92669e3d54b7106e069a8d3cff415ee31affebdfa6b0bc';
const DEFAULT_CONTRACT = process.env.CONTRACT_ADDRESS || '0x59D9D2c4920527CE1337b82C9fDC5e776e2615A3';
const PORT             = process.env.PORT || 3003;

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

let client = null;
let account = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function initializeClient() {
  try {
    account = createAccount(OPERATOR_KEY);
    client  = createClient({ chain: studionet, account });
    await client.initializeConsensusSmartContract();
    console.log('✅ Connected! Operator:', account.address);
    return true;
  } catch(err) {
    console.error('❌ Connection failed:', err.message);
    return false;
  }
}

async function waitForTx(hash, label) {
  const MAX = 24;
  for (let i = 0; i < MAX; i++) {
    await sleep(5000);
    try {
      const receipt = await client.waitForTransactionReceipt({ hash, retries: 1 });
      if (receipt) {
        console.log('✅ Done:', label);
        // Try to parse result
        const raw = JSON.stringify(receipt);
        const match = raw.match(/"(\{[^"]*"success"[^"]*\})"/);
        if (match) {
          try {
            const parsed = JSON.parse(match[1].replace(/\\"/g, '"').replace(/\\n/g, ''));
            console.log('📦 parsed:', JSON.stringify(parsed).substring(0,100));
            return { success: true, data: parsed };
          } catch(e) {}
        }
        // Try eq_outputs
        if (receipt.consensus_data) {
          const cd = receipt.consensus_data;
          const leader = cd.final_used_leader_receipt || cd.leader_receipt;
          if (leader?.execution_result) {
            try {
              const parsed = typeof leader.execution_result === 'string'
                ? JSON.parse(leader.execution_result)
                : leader.execution_result;
              return { success: true, data: parsed };
            } catch(e) {}
          }
        }
        return { success: false, error: 'Finalized but could not parse' };
      }
    } catch(e) {
      if (i < MAX - 1) continue;
    }
  }
  return { success: false, error: 'Timeout' };
}

// ── ROUTES ────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'alive', service: 'GenLayer Weather Oracle', port: PORT });
});

// Live weather via Open-Meteo (free, no API key)
const geoCache = {};
const wxCache  = {};
const TTL      = 5 * 60 * 1000;

app.get('/api/live-weather', async (req, res) => {
  const city = req.query.city;
  if (!city) return res.json({ success: false, error: 'city required' });

  const key = city.toLowerCase();
  if (wxCache[key] && Date.now() - wxCache[key].ts < TTL) {
    return res.json({ success: true, weather: wxCache[key].data, cached: true });
  }

  try {
    console.log('🌍 Geocoding:', city);
    let lat, lon, country, resolvedCity;

    if (geoCache[key]) {
      ({ lat, lon, country, resolvedCity } = geoCache[key]);
    } else {
      const gr = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
      const gj = await gr.json();
      if (!gj.results?.length) return res.json({ success: false, error: 'City not found' });
      const g = gj.results[0];
      lat = g.latitude; lon = g.longitude;
      country = g.country_code || '';
      resolvedCity = g.name || city;
      geoCache[key] = { lat, lon, country, resolvedCity };
    }

    console.log('🌤️ Fetching weather:', resolvedCity);
    const wr = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,visibility,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&wind_speed_unit=mph&timezone=auto&forecast_days=5`);
    const wj = await wr.json();
    const cur = wj.current;
    const daily = wj.daily;

    function codeToCondition(code) {
      if (code === 0)    return { label: 'Sunny',         code: 'sunny'         };
      if (code <= 2)     return { label: 'Partly Cloudy', code: 'partly_cloudy' };
      if (code === 3)    return { label: 'Overcast',      code: 'cloudy'        };
      if (code <= 49)    return { label: 'Foggy',         code: 'foggy'         };
      if (code <= 67)    return { label: 'Rainy',         code: 'rainy'         };
      if (code <= 77)    return { label: 'Snowy',         code: 'snowy'         };
      if (code <= 82)    return { label: 'Rainy',         code: 'rainy'         };
      if (code <= 99)    return { label: 'Thunderstorm',  code: 'thunderstorm'  };
      return { label: 'Cloudy', code: 'cloudy' };
    }

    const cond  = codeToCondition(cur.weather_code);
    const tempC = Math.round(cur.temperature_2m * 10) / 10;
    const tempF = Math.round((tempC * 9/5 + 32) * 10) / 10;
    const feelC = Math.round(cur.apparent_temperature * 10) / 10;
    const feelF = Math.round((feelC * 9/5 + 32) * 10) / 10;
    const windMph = Math.round(cur.wind_speed_10m * 10) / 10;
    const windKph = Math.round(windMph * 1.60934 * 10) / 10;

    const days = ['Today', 'Tomorrow', 'Wed', 'Thu', 'Fri'];
    const forecast = (daily.time || []).slice(0, 5).map((_, i) => {
      const fc = codeToCondition(daily.weather_code[i]);
      return {
        day:          days[i] || 'Day ' + (i+1),
        high_c:       Math.round(daily.temperature_2m_max[i]),
        low_c:        Math.round(daily.temperature_2m_min[i]),
        high_f:       Math.round(daily.temperature_2m_max[i] * 9/5 + 32),
        low_f:        Math.round(daily.temperature_2m_min[i] * 9/5 + 32),
        condition:    fc.label,
        condition_code: fc.code,
        rain_chance:  daily.precipitation_probability_max[i] || 0,
      };
    });

    const weather = {
      city: resolvedCity, country, temp_c: tempC, temp_f: tempF,
      feels_like_c: feelC, feels_like_f: feelF,
      humidity: cur.relative_humidity_2m,
      wind_mph: windMph, wind_kph: windKph,
      condition: cond.label, condition_code: cond.code,
      uv_index: cur.uv_index || 0,
      visibility_km: cur.visibility ? Math.round(cur.visibility / 1000) : 10,
      forecast,
    };

    wxCache[key] = { data: weather, ts: Date.now() };
    console.log('✅ Live weather:', resolvedCity, tempC + '°C', cond.label);
    res.json({ success: true, weather });
  } catch(err) {
    console.log('❌ Weather error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/get-weather', async (req, res) => {
  const { contract, city } = req.body;
  const ca = contract || DEFAULT_CONTRACT;
  console.log('🌤️ get_weather(' + city + ') via contract', ca.slice(0,10) + '...');
  try {
    const hash = await client.writeContract({
      address: ca, functionName: 'get_weather', args: [city], value: 0n,
    });
    console.log('⏳ Waiting...', hash);
    const result = await waitForTx(hash, 'get_weather');
    res.json(result);
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/record-weather', async (req, res) => {
  const { contract, city } = req.body;
  const ca = contract || DEFAULT_CONTRACT;
  console.log('📌 record_weather(' + city + ')...');
  try {
    const hash = await client.writeContract({
      address: ca, functionName: 'record_weather', args: [city], value: 0n,
    });
    console.log('⏳ Waiting...', hash);
    const result = await waitForTx(hash, 'record_weather');
    res.json(result);
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/weather-history', async (req, res) => {
  const { contract, city } = req.query;
  const ca = contract || DEFAULT_CONTRACT;
  try {
    const result = await client.readContract({
      address: ca, functionName: 'get_weather_history', args: [city],
    });
    res.json({ success: true, data: result });
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});

// Start
const ok = await initializeClient();
if (!ok) { console.error('Failed to connect. Exiting.'); process.exit(1); }
app.listen(PORT, () => {
  console.log('✅ Weather Oracle Backend running on port', PORT);
  console.log('📌 Health: http://localhost:' + PORT + '/health');
  console.log('💡 Deploy weather_oracle.py to GenLayer Studio first!');
});