let map, currentLayerIndex = 0;
let layers = [];
let path = [];
let polyline;
let watchID;
let startTime, timerInterval;
let totalDistance = 0;
let elevationGain = 0;
let lastPos = null;
let paceData = [];

const distanceEl = document.getElementById("distance");
const timeEl = document.getElementById("time");
const paceEl = document.getElementById("pace");
const elevationEl = document.getElementById("elevation");

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function initMap() {
  map = L.map('map').setView([-34.6, -58.4], 15);

  layers = [
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'),
    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png'),
  ];

  layers[0].addTo(map);
  polyline = L.polyline([], { color: 'yellow', weight: 5 }).addTo(map);
}

function switchLayer() {
  map.removeLayer(layers[currentLayerIndex]);
  currentLayerIndex = (currentLayerIndex + 1) % layers.length;
  layers[currentLayerIndex].addTo(map);
}

function updateStats(position) {
  const { latitude, longitude, altitude } = position.coords;
  const newPoint = [latitude, longitude];

  if (lastPos) {
    const prevLatLng = L.latLng(lastPos[0], lastPos[1]);
    const newLatLng = L.latLng(latitude, longitude);
    const distance = prevLatLng.distanceTo(newLatLng) / 1000;
    totalDistance += distance;

    if (altitude && lastPos[2] !== null && altitude > lastPos[2]) {
      elevationGain += (altitude - lastPos[2]);
    }

    const elapsed = Date.now() - startTime;
    const pace = elapsed / (totalDistance * 1000); // ms/m
    const paceMin = Math.floor(pace / 60000);
    const paceSec = Math.floor((pace % 60000) / 1000);

    distanceEl.textContent = totalDistance.toFixed(2);
    elevationEl.textContent = Math.round(elevationGain);
    paceEl.textContent = `${paceMin}:${String(paceSec).padStart(2, '0')}`;
    paceData.push({ km: totalDistance, pace: paceMin + paceSec / 60 });
  }

  lastPos = [latitude, longitude, altitude || null];
  path.push(newPoint);
  polyline.setLatLngs(path);
  map.setView(newPoint);
}

function startTracking() {
  if (!navigator.geolocation) {
    alert("GPS no soportado.");
    return;
  }

  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    timeEl.textContent = formatTime(elapsed);
  }, 1000);

  watchID = navigator.geolocation.watchPosition(updateStats, console.error, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 5000,
  });

  document.getElementById("pauseBtn").disabled = false;
  document.getElementById("resetBtn").disabled = false;
  document.getElementById("startBtn").disabled = true;
}

function pauseTracking() {
  navigator.geolocation.clearWatch(watchID);
  clearInterval(timerInterval);
}

function resetTracking() {
  pauseTracking();
  path = [];
  polyline.setLatLngs([]);
  totalDistance = 0;
  elevationGain = 0;
  lastPos = null;
  paceData = [];
  distanceEl.textContent = "0.00";
  elevationEl.textContent = "0";
  timeEl.textContent = "00:00:00";
  paceEl.textContent = "0:00";
  document.getElementById("startBtn").disabled = false;
  document.getElementById("pauseBtn").disabled = true;
  document.getElementById("resetBtn").disabled = true;
  drawChart(); // borra gráfico
}

function drawChart() {
  const ctx = document.getElementById("paceChart").getContext("2d");
  new Chart(ctx, {
    type: "line",
    data: {
      labels: paceData.map(p => p.km.toFixed(2)),
      datasets: [{
        label: "Ritmo (min/km)",
        data: paceData.map(p => p.pace.toFixed(2)),
        borderColor: "#ffeb3b",
        backgroundColor: "#ffeb3b33",
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#ffeb3b" } } },
      scales: {
        x: { ticks: { color: "#ffeb3b" } },
        y: { ticks: { color: "#ffeb3b" } }
      }
    }
  });
}

document.getElementById("startBtn").addEventListener("click", startTracking);
document.getElementById("pauseBtn").addEventListener("click", pauseTracking);
document.getElementById("resetBtn").addEventListener("click", resetTracking);
document.getElementById("layerBtn").addEventListener("click", switchLayer);

window.onload = () => {
  initMap();
};
