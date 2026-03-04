import express from 'express';
import cors from 'cors';
import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionStatus } from 'genlayer-js/types';

const OPERATOR_KEY     = process.env.OPERATOR_PRIVATE_KEY || '0xa7db0893b5433f384c92669e3d54b7106e069a8d3cff415ee31affebdfa6b0bc';
const DEFAULT_CONTRACT = process.env.CONTRACT_ADDRESS || '0x59D9D2c4920527CE1337b82C9fDC5e776e2615A3';
const PORT             = process.env.PORT || 3003;

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
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

async function callContract(contractAddress, functionName, args = []) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`📝 ${functionName} (attempt ${attempt})`);
      const txHash = await client.writeContract({
        address: contractAddress, functionName, args, value: 0n, leaderOnly: true,
      });
      console.log('⏳ Waiting...', txHash);
      const receipt = await client.waitForTransactionReceipt({
        hash: txHash, status: TransactionStatus.ACCEPTED, retries: 30, interval: 3000,
      });
      console.log('✅ Done:', functionName);
      return receipt;
    } catch(err) {
      console.log(`Attempt ${attempt} failed: ${err.message.slice(0,80)}`);
      if (attempt < 3) await sleep(4000);
      else throw err;
    }
  }
}

function extractResult(receipt) {
  try {
    const lr = receipt?.consensus_data?.leader_receipt?.[0];

    // 1. readable
    const readable = lr?.result?.payload?.readable;
    if (readable) {
      console.log('📦 readable raw:', String(readable).slice(0, 200));
      let str = readable;
      if (typeof str === 'string' && str.startsWith('"') && str.endsWith('"')) str = str.slice(1,-1);
      str = str.replace(/\\"/g, '"').replace(/\\n/g, '').replace(/\\t/g, '');
      try { const r = JSON.parse(str); console.log('✅ Parsed from readable'); return r; } catch(e) {}
      try { const r = JSON.parse(readable); return r; } catch(e) {}
    }

    // 2. stdout
    const stdout = lr?.genvm_result?.stdout;
    if (stdout?.trim()) {
      try { const r = JSON.parse(stdout.trim()); console.log('✅ Parsed from stdout'); return r; } catch(e) {}
    }

    // 3. eq_outputs
    const eq = lr?.eq_outputs;
    if (eq && Object.keys(eq).length > 0) {
      const first = Object.values(eq)[0];
      try { const r = JSON.parse(first); console.log('✅ Parsed from eq_outputs'); return r; } catch(e) {}
    }

    console.log('⚠️ Full lr keys:', Object.keys(lr || {}));
    console.log('⚠️ lr.result:', JSON.stringify(lr?.result)?.slice(0, 200));
    return null;
  } catch(e) {
    return null;
  }
}

// ── LIVE WEATHER (Open-Meteo) ─────────────────
const geoCache = {};
const wxCache  = {};
const TTL      = 5 * 60 * 1000;

app.get('/health', (req, res) => {
  res.json({ status: 'alive', service: 'GenLayer Weather Oracle', port: PORT });
});

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
      if (code === 0)  return { label: 'Sunny',         code: 'sunny'         };
      if (code <= 2)   return { label: 'Partly Cloudy', code: 'partly_cloudy' };
      if (code === 3)  return { label: 'Overcast',      code: 'cloudy'        };
      if (code <= 49)  return { label: 'Foggy',         code: 'foggy'         };
      if (code <= 67)  return { label: 'Rainy',         code: 'rainy'         };
      if (code <= 77)  return { label: 'Snowy',         code: 'snowy'         };
      if (code <= 82)  return { label: 'Rainy',         code: 'rainy'         };
      if (code <= 99)  return { label: 'Thunderstorm',  code: 'thunderstorm'  };
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
        day: days[i] || 'Day '+(i+1),
        high_c: Math.round(daily.temperature_2m_max[i]),
        low_c:  Math.round(daily.temperature_2m_min[i]),
        high_f: Math.round(daily.temperature_2m_max[i] * 9/5 + 32),
        low_f:  Math.round(daily.temperature_2m_min[i] * 9/5 + 32),
        condition: fc.label, condition_code: fc.code,
        rain_chance: daily.precipitation_probability_max[i] || 0,
      };
    });

    const weather = {
      city: resolvedCity, country, temp_c: tempC, temp_f: tempF,
      feels_like_c: feelC, feels_like_f: feelF,
      humidity: cur.relative_humidity_2m,
      wind_mph: windMph, wind_kph: windKph,
      condition: cond.label, condition_code: cond.code,
      uv_index: cur.uv_index || 0,
      visibility_km: cur.visibility ? Math.round(cur.visibility/1000) : 10,
      forecast,
    };

    wxCache[key] = { data: weather, ts: Date.now() };
    console.log('✅ Live weather:', resolvedCity, tempC+'°C', cond.label);
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
    const receipt = await callContract(ca, 'get_weather', [city]);
    const data    = extractResult(receipt);
    if (data) return res.json({ success: true, data });
    res.json({ success: false, error: 'Could not parse contract result' });
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/record-weather', async (req, res) => {
  const { contract, city } = req.body;
  const ca = contract || DEFAULT_CONTRACT;
  console.log('📌 record_weather(' + city + ')...');
  try {
    const receipt = await callContract(ca, 'record_weather', [city]);
    const data    = extractResult(receipt);
    if (data) return res.json({ success: true, data });
    res.json({ success: false, error: 'Could not parse contract result' });
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

const ok = await initializeClient();
if (!ok) { process.exit(1); }
app.listen(PORT, () => {
  console.log('✅ Weather Oracle Backend running on port', PORT);
  console.log('📌 Health: http://localhost:' + PORT + '/health');
  console.log('💡 Deploy weather_oracle.py to GenLayer Studio first!');
});