const express    = require('express');
const cors       = require('cors');
const { createClient, TransactionStatus } = require('genlayer-js');
const { privateKeyToAccount } = require('genlayer-js/accounts');

const app  = express();
const PORT = process.env.PORT || 3003;

const PRIVATE_KEY       = process.env.OPERATOR_PRIVATE_KEY;
const CONTRACT_ADDRESS  = process.env.CONTRACT_ADDRESS || '0x59D9D2c4920527CE1337b82C9fDC5e776e2615A3';

app.use(cors());
app.use(express.json());

let client;

async function connect() {
  try {
    const account = privateKeyToAccount(PRIVATE_KEY);
    client = createClient({
      network:  'studionet',
      account,
      endpoint: 'https://studio.genlayer.com/api',
    });
    const op = await client.getOperatorAddress();
    console.log('✅ Connected! Operator:', op);
    console.log('✅ Weather Oracle Backend running on port', PORT);
    console.log('📌 Health: http://localhost:' + PORT + '/health');
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  }
}

// Wait for transaction helper
async function waitForTx(hash, label) {
  const MAX = 20;
  for (let i = 0; i < MAX; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const lr = await client.getTransactionByHash(hash);
      if (!lr) continue;

      // Try readable result
      if (lr.consensus_data?.final_used_leader_receipt?.execution_result) {
        const raw = lr.consensus_data.final_used_leader_receipt.execution_result;
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          console.log('✅ Done:', label);
          return { success: true, data: parsed };
        } catch(e) {}
      }

      // Try eq_outputs
      if (lr.eq_outputs) {
        const outputs = Array.isArray(lr.eq_outputs) ? lr.eq_outputs : Object.values(lr.eq_outputs);
        for (const o of outputs) {
          const val = o?.result ?? o?.value ?? o;
          if (val && typeof val === 'string' && val.includes('{')) {
            try {
              const parsed = JSON.parse(val);
              console.log('✅ Done:', label);
              return { success: true, data: parsed };
            } catch(e) {}
          }
        }
      }

      // Check for readable string result
      if (lr.result && typeof lr.result === 'string' && lr.result.includes('{')) {
        try {
          const parsed = JSON.parse(lr.result);
          console.log('✅ Done:', label);
          return { success: true, data: parsed };
        } catch(e) {}
      }

      const status = lr.status ?? lr.statusName ?? '';
      if (String(status).includes('FINALIZED') || String(status) === '7') {
        // Try to extract from genvm_result
        if (lr.genvm_result) {
          try {
            const gv = typeof lr.genvm_result === 'string' ? JSON.parse(lr.genvm_result) : lr.genvm_result;
            if (gv.stdout) {
              const parsed = JSON.parse(gv.stdout);
              console.log('✅ Done (genvm):', label);
              return { success: true, data: parsed };
            }
          } catch(e) {}
        }

        // Parse readable field
        try {
          const readable = JSON.parse(JSON.stringify(lr));
          const str = JSON.stringify(readable);
          const match = str.match(/"({[^"]*success[^"]*})"/);
          if (match) {
            const unescaped = match[1].replace(/\\"/g, '"');
            const parsed = JSON.parse(unescaped);
            console.log('📦 readable raw:', JSON.stringify(parsed).substring(0, 120));
            console.log('✅ Parsed from readable');
            return { success: true, data: parsed };
          }
        } catch(e) {}

        if (lr.result?.status === 'contract_error') {
          console.log('⚠️ Contract error:', lr.result?.payload);
          return { success: false, error: 'Contract error: ' + lr.result?.payload };
        }

        return { success: false, error: 'Finalized but could not parse result' };
      }
    } catch(e) {}
  }
  return { success: false, error: 'Timeout after ' + MAX + ' attempts' };
}

// ── ROUTES ────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'alive', service: 'GenLayer Weather Oracle', port: PORT });
});

// Live weather proxy (Open-Meteo - completely free, no API key)
const geoCache   = {};
const wxCache    = {};
const CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

app.get('/api/live-weather', async (req, res) => {
  const city = req.query.city;
  if (!city) return res.json({ success: false, error: 'city required' });

  const cacheKey = city.toLowerCase();
  if (wxCache[cacheKey] && Date.now() - wxCache[cacheKey].ts < CACHE_TTL) {
    return res.json({ success: true, weather: wxCache[cacheKey].data, cached: true });
  }

  try {
    // Step 1: Geocode city name
    console.log('🌍 Geocoding:', city);
    let lat, lon, country, resolvedCity;

    if (geoCache[cacheKey]) {
      ({ lat, lon, country, resolvedCity } = geoCache[cacheKey]);
    } else {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
      const gr     = await fetch(geoUrl);
      const gj     = await gr.json();
      if (!gj.results?.length) return res.json({ success: false, error: 'City not found' });
      const g = gj.results[0];
      lat = g.latitude; lon = g.longitude;
      country = g.country_code || '';
      resolvedCity = g.name || city;
      geoCache[cacheKey] = { lat, lon, country, resolvedCity };
    }

    // Step 2: Get weather from Open-Meteo
    console.log('🌤️ Fetching weather for:', resolvedCity, lat, lon);
    const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,visibility,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&wind_speed_unit=mph&timezone=auto&forecast_days=5`;
    const wr  = await fetch(wxUrl);
    const wj  = await wr.json();

    const cur = wj.current;
    const daily = wj.daily;

    function wxCodeToCondition(code) {
      if (code === 0)                    return { label: 'Sunny',         code: 'sunny'          };
      if (code <= 2)                     return { label: 'Partly Cloudy', code: 'partly_cloudy'  };
      if (code === 3)                    return { label: 'Overcast',      code: 'cloudy'         };
      if (code <= 49)                    return { label: 'Foggy',         code: 'foggy'          };
      if (code <= 67)                    return { label: 'Rainy',         code: 'rainy'          };
      if (code <= 77)                    return { label: 'Snowy',         code: 'snowy'          };
      if (code <= 82)                    return { label: 'Rainy',         code: 'rainy'          };
      if (code <= 99)                    return { label: 'Thunderstorm',  code: 'thunderstorm'   };
      return { label: 'Cloudy', code: 'cloudy' };
    }

    const cond    = wxCodeToCondition(cur.weather_code);
    const tempC   = Math.round(cur.temperature_2m * 10) / 10;
    const tempF   = Math.round((tempC * 9/5 + 32) * 10) / 10;
    const feelC   = Math.round(cur.apparent_temperature * 10) / 10;
    const feelF   = Math.round((feelC * 9/5 + 32) * 10) / 10;
    const windMph = Math.round(cur.wind_speed_10m * 10) / 10;
    const windKph = Math.round(windMph * 1.60934 * 10) / 10;

    const days = ['Today', 'Tomorrow', 'Wed', 'Thu', 'Fri'];
    const forecast = (daily.time || []).slice(0, 5).map((_, i) => {
      const fc = wxCodeToCondition(daily.weather_code[i]);
      return {
        day:        days[i] || ('Day ' + (i+1)),
        high_c:     Math.round(daily.temperature_2m_max[i]),
        low_c:      Math.round(daily.temperature_2m_min[i]),
        high_f:     Math.round(daily.temperature_2m_max[i] * 9/5 + 32),
        low_f:      Math.round(daily.temperature_2m_min[i] * 9/5 + 32),
        condition:  fc.label,
        condition_code: fc.code,
        rain_chance: daily.precipitation_probability_max[i] || 0,
      };
    });

    const weather = {
      city:            resolvedCity,
      country:         country,
      temp_c:          tempC,
      temp_f:          tempF,
      feels_like_c:    feelC,
      feels_like_f:    feelF,
      humidity:        cur.relative_humidity_2m,
      wind_mph:        windMph,
      wind_kph:        windKph,
      condition:       cond.label,
      condition_code:  cond.code,
      uv_index:        cur.uv_index || 0,
      visibility_km:   cur.visibility ? Math.round(cur.visibility / 1000) : 10,
      forecast,
    };

    wxCache[cacheKey] = { data: weather, ts: Date.now() };
    console.log('✅ Live weather:', resolvedCity, tempC + '°C', cond.label);
    res.json({ success: true, weather });
  } catch(err) {
    console.log('❌ Weather error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// Get weather on-chain
app.post('/api/get-weather', async (req, res) => {
  const { contract, city } = req.body;
  const ca = contract || CONTRACT_ADDRESS;
  console.log('🌤️ get_weather(' + city + ') via contract', ca.slice(0,10) + '...');

  try {
    console.log('📝 get_weather (attempt 1)');
    const hash = await client.callContractFunction({
      contractAddress: ca,
      functionName:    'get_weather',
      args:            [city],
      value:           BigInt(0),
    });
    console.log('⏳ Waiting...', hash);
    const result = await waitForTx(hash, 'get_weather');
    res.json(result);
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});

// Record weather on-chain
app.post('/api/record-weather', async (req, res) => {
  const { contract, city } = req.body;
  const ca = contract || CONTRACT_ADDRESS;
  console.log('◈ record_weather(' + city + ') — storing on-chain...');

  try {
    console.log('📝 record_weather (attempt 1)');
    const hash = await client.callContractFunction({
      contractAddress: ca,
      functionName:    'record_weather',
      args:            [city],
      value:           BigInt(0),
    });
    console.log('⏳ Waiting...', hash);
    const result = await waitForTx(hash, 'record_weather');
    res.json(result);
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});

// Weather history
app.get('/api/weather-history', async (req, res) => {
  const { contract, city } = req.query;
  const ca = contract || CONTRACT_ADDRESS;
  try {
    const result = await client.readContractFunction({
      contractAddress: ca,
      functionName:    'get_weather_history',
      args:            [city],
    });
    res.json({ success: true, data: result });
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});

connect().then(() => {
  app.listen(PORT, () => {
    console.log('💡 Deploy weather_oracle.py to GenLayer Studio first!');
  });
});
