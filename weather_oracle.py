# v1.0.0
# { "Depends": "py-genlayer:test" }

from genlayer import *
import json


class WeatherOracle(gl.Contract):

    weather_snapshots: TreeMap[str, str]
    snapshot_counts:   TreeMap[str, str]
    latest_weather:    TreeMap[str, str]
    tracked_cities:    str
    total_queries:     str

    def __init__(self) -> None:
        self.tracked_cities = ""
        self.total_queries  = "0"

    def _split(self, value: str) -> list:
        if not value:
            return []
        return [x for x in value.split("|") if x]

    def _track(self, city: str) -> None:
        known = self._split(self.tracked_cities)
        if city not in known:
            known.append(city)
            self.tracked_cities = "|".join(known)

    def _clean(self, raw: str) -> str:
        raw = raw.strip()
        if raw.startswith("```"):
            lines = raw.split("\n")
            raw = "\n".join(lines[1:])
        raw = raw.replace("```json", "").replace("```", "").strip()
        return raw

    @gl.public.write
    def get_weather(self, city: str) -> str:
        city = city.strip()

        prompt = (
            "You are a weather data oracle. "
            "Based on your training data, provide typical/approximate current weather for: " + city + ". "
            "Give realistic estimates for the current season and location. "
            "Respond with ONLY this JSON on one line, no markdown, no explanation: "
            "{\"success\": true, \"city\": \"" + city + "\", "
            "\"country\": \"US\", "
            "\"temp_c\": 22.5, \"temp_f\": 72.5, "
            "\"feels_like_c\": 21.0, \"feels_like_f\": 69.8, "
            "\"humidity\": 65, \"wind_kph\": 14.4, \"wind_mph\": 8.9, "
            "\"condition\": \"Partly Cloudy\", "
            "\"condition_code\": \"partly_cloudy\", "
            "\"uv_index\": 5, \"visibility_km\": 10, "
            "\"forecast\": ["
            "{\"day\": \"Today\", \"high_c\": 24, \"low_c\": 18, \"condition\": \"Partly Cloudy\", \"condition_code\": \"partly_cloudy\", \"rain_chance\": 20},"
            "{\"day\": \"Tomorrow\", \"high_c\": 26, \"low_c\": 19, \"condition\": \"Sunny\", \"condition_code\": \"sunny\", \"rain_chance\": 5},"
            "{\"day\": \"Wed\", \"high_c\": 23, \"low_c\": 17, \"condition\": \"Rainy\", \"condition_code\": \"rainy\", \"rain_chance\": 80},"
            "{\"day\": \"Thu\", \"high_c\": 20, \"low_c\": 15, \"condition\": \"Cloudy\", \"condition_code\": \"cloudy\", \"rain_chance\": 40},"
            "{\"day\": \"Fri\", \"high_c\": 25, \"low_c\": 18, \"condition\": \"Sunny\", \"condition_code\": \"sunny\", \"rain_chance\": 10}"
            "], "
            "\"source\": \"GenLayer AI Oracle\", "
            "\"verified_by\": \"GenLayer Consensus\"}"
        )

        def fetch():
            raw = gl.nondet.exec_prompt(prompt)
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                cleaned = "\n".join(lines[1:])
            cleaned = cleaned.replace("```json", "").replace("```", "").strip()
            return cleaned

        result_str = gl.eq_principle.strict_eq(fetch)
        data = json.loads(result_str)

        # State writes after nondet
        self.total_queries = str(int(self.total_queries) + 1)
        self._track(city)
        self.latest_weather[city] = result_str

        return json.dumps(data)

    @gl.public.write
    def record_weather(self, city: str) -> str:
        city = city.strip()

        prompt = (
            "You are a weather data oracle. "
            "Provide approximate current weather conditions for: " + city + ". "
            "Respond with ONLY this JSON on one line, no markdown: "
            "{\"temp_c\": 22.5, \"temp_f\": 72.5, \"humidity\": 65, "
            "\"wind_kph\": 14.4, \"condition\": \"Partly Cloudy\", "
            "\"condition_code\": \"partly_cloudy\"}"
        )

        def fetch():
            raw = gl.nondet.exec_prompt(prompt)
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                cleaned = "\n".join(lines[1:])
            cleaned = cleaned.replace("```json", "").replace("```", "").strip()
            return cleaned

        result_str = gl.eq_principle.strict_eq(fetch)
        cd = json.loads(result_str)

        count    = int(self.snapshot_counts.get(city, "0"))
        snap_key = city + ":" + str(count)

        snapshot = json.dumps({
            "temp_c":         cd.get("temp_c", 0),
            "temp_f":         cd.get("temp_f", 0),
            "humidity":       cd.get("humidity", 0),
            "wind_kph":       cd.get("wind_kph", 0),
            "condition":      cd.get("condition", ""),
            "condition_code": cd.get("condition_code", ""),
            "city":           city,
            "snapshot_index": count,
        })

        self.weather_snapshots[snap_key] = snapshot
        self.snapshot_counts[city]       = str(count + 1)
        self.latest_weather[city]        = snapshot
        self.total_queries               = str(int(self.total_queries) + 1)
        self._track(city)

        return json.dumps({
            "success":        True,
            "city":           city,
            "temp_c":         cd.get("temp_c", 0),
            "temp_f":         cd.get("temp_f", 0),
            "humidity":       cd.get("humidity", 0),
            "wind_kph":       cd.get("wind_kph", 0),
            "condition":      cd.get("condition", ""),
            "snapshot_index": count,
            "stored_on_chain": True,
            "verified_by":    "GenLayer Consensus",
        })

    @gl.public.view
    def get_weather_history(self, city: str) -> dict:
        city  = city.strip()
        count = int(self.snapshot_counts.get(city, "0"))
        if count == 0:
            return {"city": city, "snapshots": [], "count": 0}
        snapshots = []
        for i in range(count):
            key = city + ":" + str(i)
            raw = self.weather_snapshots.get(key, "")
            if raw:
                try:
                    snapshots.append(json.loads(raw))
                except Exception:
                    pass
        return {
            "city":      city,
            "snapshots": snapshots,
            "count":     len(snapshots),
        }

    @gl.public.view
    def get_tracked_cities(self) -> dict:
        cities = self._split(self.tracked_cities)
        return {
            "cities":        cities,
            "total_queries": int(self.total_queries),
        }

    @gl.public.view
    def get_stats(self) -> dict:
        return {
            "total_queries": int(self.total_queries),
            "tracked_cities": len(self._split(self.tracked_cities)),
            "source":        "GenLayer AI Weather Oracle",
            "network":       "GenLayer Studionet",
        }
