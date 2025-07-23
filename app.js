let map, userMarker, polyline;
let watchId = null;
let pathCoords = [];
let elevationData = [];
let startTime = null;
let timerInterval = null;
let distance = 0;
let lastPosition = null;
let splits = [];
let elevationGain = 0;

const startStopBtn = document.getElementById("startStopBtn");
const resetBtn = document.getElementById("resetBtn");
const timeEl = document.getElementById("time");
const distanceEl = document.getElementById("distance");
const paceEl = document.getElementById("pace");
const elevationEl = document.getElementById("elevation");
const splitsEl = document.getElementById("splits");

function initMap() {
  map = L.map("map", {
    zoomControl: true,
    minZoom: 3,
  }).setView([0, 0], 13);

  const baseLayers = {
    "Calles": L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: "&copy; OpenStreetMap" }
    ),
    "Terreno": L.tileLayer(
      "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      { maxZoom: 17, attribution: "© OpenTopoMap" }
    ),
    "Toner": L.tileLayer(
      "https://stamen-tiles.a.ssl.fastly.net/toner/{z}/{x}/{y}.png",
      { maxZoom: 20, attribution: "Map tiles by Stamen Design" }
    ),
  };

  baseLayers["Calles"].addTo(map);
  L.control.layers(baseLayers).addTo(map);
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatPace(pace) {
  if (!pace || pace === Infinity) return "0:00";
  const min = Math.floor(pace);
  const sec = Math.round((pace - min) * 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function updateStats() {
  if (!startTime) {
    timeEl.textContent = "00:00:00";
    distanceEl.textContent = "0.00";
    paceEl.textContent = "0:00";
    elevationEl.textContent = "0";
    return;
  }

  const now = Date.now();
  const elapsedSec = Math.floor((now - startTime) / 1000);
  timeEl.textContent = formatTime(elapsedSec);
  distanceEl.textContent = (distance / 1000).toFixed(2);

  let pace = distance > 0 ? elapsedSec / 60 / (distance / 1000) : 0;
  paceEl.textContent = formatPace(pace);

  elevationEl.textContent = elevationGain.toFixed(0);
}

function calcElevationGain(newEle) {
  if (elevationData.length === 0) {
    elevationData.push(newEle);
    return 0;
  }
  let lastEle = elevationData[elevationData.length - 1];
  let gain = 0;
  if (newEle > lastEle) gain = newEle - lastEle;
  elevationData.push(newEle);
  return gain;
}

function checkSplits() {
  const km = Math.floor(distance / 1000);
  if (km > 0 && splits[splits.length - 1] !== km) {
    const now = Date.now();
    const elapsedSec = (now - startTime) / 1000;
    splits.push(km);

    const li = document.createElement("li");
    li.textContent = `Km ${km} - Tiempo: ${formatTime(elapsedSec)}`;
    splitsEl.prepend(li);

    alert(`Parcial ${km} km: ${formatTime(elapsedSec)}`);

    if ("speechSynthesis" in window) {
      const msg = new SpeechSynthesisUtterance(
        `Kilómetro ${km}, tiempo ${formatTime(elapsedSec)}`
      );
      window.speechSynthesis.speak(msg);
    }
  }
}

// Gráfico con Chart.js
let elevationChart;
function initChart() {
  const ctx = document.getElementById("elevationChart").getContext("2d");
  elevationChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Elevación (m)",
          data: [],
          borderColor: "#ffd600",
          backgroundColor: "rgba(255, 214, 0, 0.3)",
          tension: 0.3,
          fill: true,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      scales: {
        x: { display: false },
        y: {
          ticks: { color: "#ffd600" },
          grid: { color: "#444" },
        },
      },
      plugins: {
        legend: { labels: { color: "#ffd600" } },
      },
    },
  });
}

function updateChart() {
  if (!elevationChart) return;
  elevationChart.data.labels = pathCoords.map((_, i) => i);
  elevationChart.data.datasets[0].data = elevationData;
  elevationChart.update("none");
}

function onPositionUpdate(pos) {
  const { latitude, longitude, altitude } = pos.coords;

  if (!userMarker) {
    userMarker = L.marker([latitude, longitude], {
      icon: L.icon({
        iconUrl: "https://cdn-icons-png.flaticon.com/512/64/64113.png",
        iconSize: [25, 25],
        iconAnchor: [12, 25],
      }),
    }).addTo(map);
  } else {
    userMarker.setLatLng([latitude, longitude]);
  }

  if (pathCoords.length === 0) {
    map.setView([latitude, longitude], 15);
  }

  const newPoint = [latitude, longitude];
  const newEle = altitude ?? 0;

  if (lastPosition) {
    const d = haversine(lastPosition[0], lastPosition[1], latitude, longitude);
    if (d > 0.5) {
      distance += d;
      const gain = calcElevationGain(newEle);
      elevationGain += gain;
      pathCoords.push(newPoint);
      if (polyline) polyline.setLatLngs(pathCoords);
      else
        polyline = L.polyline(pathCoords, {
          color: "#ffd600",
          weight: 5,
          opacity: 0.8,
          lineJoin: "round",
        }).addTo(map);

      updateStats();
      updateChart();
      checkSplits();
    }
  } else {
    pathCoords.push(newPoint);
    elevationData.push(newEle);
    polyline = L.polyline(pathCoords, {
      color: "#ffd600",
      weight: 5,
      opacity: 0.8,
      lineJoin: "round",
    }).addTo(map);
  }

  lastPosition = newPoint;
}

function onPositionError(err) {
  alert(
    "Error al obtener ubicación: " + err.message + ". Por favor, activa GPS y permisos."
  );
}

function toggleTracking() {
  if (watchId === null) {
    if (!navigator.geolocation) {
      alert("Tu navegador no soporta Geolocalización.");
      return;
    }

    startStopBtn.textContent = "Detener";
    resetBtn.disabled = true;
    startTime = Date.now();
    distance = 0;
    elevationGain = 0;
    pathCoords = [];
    elevationData = [];
    splits = [];
    lastPosition = null;
    splitsEl.innerHTML = "";
    updateStats();
    updateChart();

    watchId = navigator.geolocation.watchPosition(onPositionUpdate, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    });

    timerInterval = setInterval(updateStats, 1000);
  } else {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    startStopBtn.textContent = "Iniciar";
    resetBtn.disabled = false;
    clearInterval(timerInterval);
  }
}

function resetTracking() {
  if (watchId !== null) {
    alert("Para resetear primero detén el seguimiento.");
    return;
  }
  distance = 0;
  elevationGain = 0;
  pathCoords = [];
  elevationData = [];
  splits = [];
  lastPosition = null;
  splitsEl.innerHTML = "";
  updateStats();
  updateChart();

  if (userMarker) {
    map.removeLayer(userMarker);
    userMarker = null;
  }
  if (polyline) {
    map.removeLayer(polyline);
    polyline = null;
  }

  resetBtn.disabled = true;
}

startStopBtn.addEventListener("click", toggleTracking);
resetBtn.addEventListener("click", resetTracking);

initMap();
initChart();
updateStats();
