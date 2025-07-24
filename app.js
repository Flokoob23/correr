// Variables principales
let map, watchID;
let path = [];
let polyline;
let currentLayerIndex = 0;
let layers = [];
let totalDistance = 0;
let elevationGain = 0;
let startTime, timerInterval;
let lastPosition = null;
let paceData = [];
let kmAlerts = new Set();

const distanceEl = document.getElementById("distance");
const timeEl = document.getElementById("time");
const paceEl = document.getElementById("pace");
const speedEl = document.getElementById("speed");
const elevationEl = document.getElementById("elevation");

const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const layerBtn = document.getElementById("layerBtn");
const exportBtn = document.getElementById("exportBtn");
const shareBtn = document.getElementById("shareBtn");
const modeBtn = document.getElementById("modeBtn");

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function initMap() {
  map = L.map("map").setView([-34.6, -58.4], 16);
  layers = [
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }),
    L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: "© OpenTopoMap",
    }),
    L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap HOT",
    }),
  ];
  layers[0].addTo(map);
  polyline = L.polyline([], { color: "#ffeb3b", weight: 5 }).addTo(map);
}

function switchLayer() {
  map.removeLayer(layers[currentLayerIndex]);
  currentLayerIndex = (currentLayerIndex + 1) % layers.length;
  layers[currentLayerIndex].addTo(map);
}

function updateStats(position) {
  const { latitude, longitude, altitude, speed, accuracy } = position.coords;
  const timestamp = position.timestamp;
  const point = [latitude, longitude];

  if (accuracy > 20) return; // Filtrar posiciones imprecisas (>20m)

  if (lastPosition) {
    const prev = L.latLng(lastPosition.lat, lastPosition.lng);
    const curr = L.latLng(latitude, longitude);
    const d = prev.distanceTo(curr) / 1000;

    if (d > 0.005) {
      totalDistance += d;

      // Calcular ritmo (min/km)
      const elapsed = timestamp - lastPosition.time; // ms
      const pace = elapsed / (d * 1000);
      const paceMin = Math.floor(pace / 60000);
      const paceSec = Math.floor((pace % 60000) / 1000);

      paceData.push({ km: totalDistance, pace: paceMin + paceSec / 60 });

      if (altitude && lastPosition.elevation != null && altitude > lastPosition.elevation) {
        elevationGain += altitude - lastPosition.elevation;
      }

      // Actualizar stats visibles
      distanceEl.textContent = totalDistance.toFixed(2);
      elevationEl.textContent = Math.round(elevationGain);
      paceEl.textContent = `${paceMin}:${String(paceSec).padStart(2, "0")}`;
      speedEl.textContent = ((speed || (d / (elapsed / 1000))) * 3.6).toFixed(1);

      // Anuncio por voz cada km
      const kmInt = Math.floor(totalDistance);
      if (kmInt > 0 && !kmAlerts.has(kmInt)) {
        kmAlerts.add(kmInt);
        speak(`Kilómetro ${kmInt} completado. Tiempo: ${formatTime(Date.now() - startTime)}. Ritmo ${paceMin} minutos y ${paceSec} segundos por kilómetro.`);
      }
    }
  }

  lastPosition = {
    lat: latitude,
    lng: longitude,
    elevation: altitude || null,
    time: timestamp,
  };

  path.push(point);
  polyline.setLatLngs(path);
  map.setView(point, 16);
}

function startTracking() {
  if (!navigator.geolocation) {
    alert("Geolocalización no soportada.");
    return;
  }

  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    timeEl.textContent = formatTime(elapsed);
  }, 1000);

  watchID = navigator.geolocation.watchPosition(updateStats, (err) => {
    console.error("Error GPS:", err);
  }, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 7000,
  });

  startBtn.disabled = true;
  pauseBtn.disabled = false;
  resetBtn.disabled = false;
  exportBtn.disabled = true;
  shareBtn.disabled = true;
  kmAlerts.clear();
  paceData = [];
}

function pauseTracking() {
  navigator.geolocation.clearWatch(watchID);
  clearInterval(timerInterval);

  pauseBtn.disabled = true;
  exportBtn.disabled = false;
  shareBtn.disabled = false;
  startBtn.disabled = false;
}

function resetTracking() {
  pauseTracking();
  path = [];
  polyline.setLatLngs([]);
  totalDistance = 0;
  elevationGain = 0;
  lastPosition = null;
  paceData = [];
  kmAlerts.clear();
  distanceEl.textContent = "0.00";
  elevationEl.textContent = "0";
  timeEl.textContent = "00:00:00";
  paceEl.textContent = "0:00";
  speedEl.textContent = "0.0";
  drawChart(true);
  exportBtn.disabled = true;
  shareBtn.disabled = true;
  pauseBtn.disabled = true;
  startBtn.disabled = false;
}

function drawChart(clear = false) {
  const ctx = document.getElementById("paceChart").getContext("2d");
  if (window.chart) {
    window.chart.destroy();
  }
  if (clear || paceData.length === 0) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    return;
  }
  window.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: paceData.map((p) => p.km.toFixed(2)),
      datasets: [
        {
          label: "Ritmo (min/km)",
          data: paceData.map((p) => p.pace.toFixed(2)),
          borderColor: "#ffeb3b",
          backgroundColor: "#ffeb3b33",
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: "#ffeb3b" } },
        tooltip: { mode: "index", intersect: false },
      },
      scales: {
        x: {
          title: { display: true, text: "Kilómetros", color: "#ffeb3b" },
          ticks: { color: "#ffeb3b" },
          grid: { color: "#444" },
        },
        y: {
          title: { display: true, text: "Minutos por km", color: "#ffeb3b" },
          ticks: { color: "#ffeb3b" },
          grid: { color: "#444" },
          reverse: true, // porque ritmo menor es mejor
        },
      },
    },
  });
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-AR";
  window.speechSynthesis.speak(utterance);
}

function exportGPX() {
  if (path.length === 0) {
    alert("No hay recorrido para exportar.");
    return;
  }

  let gpx = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx version="1.1" creator="FLOKOOB - tu cronómetro de bolsillo" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Recorrido FLOKOOB</name>
    <trkseg>
`;

  path.forEach(([lat, lng]) => {
    gpx += `      <trkpt lat="${lat}" lon="${lng}"></trkpt>\n`;
  });

  gpx += `    </trkseg>
  </trk>
</gpx>`;

  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `flokoob_${new Date().toISOString().slice(0, 10)}.gpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function shareResults() {
  if (totalDistance === 0) {
    alert("No hay resultados para compartir.");
    return;
  }

  const elapsed = Date.now() - startTime;
  const message = `FLOKOOB - mi recorrido
Distancia: ${totalDistance.toFixed(2)} km
Tiempo: ${formatTime(elapsed)}
Ritmo: ${paceEl.textContent} min/km
Desnivel acumulado: ${Math.round(elevationGain)} m
¡A entrenar con FLOKOOB!`;

  if (navigator.share) {
    navigator.share({
      title: "Resultados FLOKOOB",
      text: message,
    }).catch(console.error);
  } else {
    prompt("Copia tus resultados:", message);
  }
}

function toggleMode() {
  document.body.classList.toggle("light");
}

startBtn.addEventListener("click", startTracking);
pauseBtn.addEventListener("click", () => {
  pauseTracking();
  drawChart();
});
resetBtn.addEventListener("click", resetTracking);
layerBtn.addEventListener("click", switchLayer);
exportBtn.addEventListener("click", exportGPX);
shareBtn.addEventListener("click", shareResults);
modeBtn.addEventListener("click", toggleMode);

window.onload = () => {
  initMap();

  // Detectar modo oscuro del sistema y aplicar
  if (
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    document.body.classList.add("light");
  }
};
