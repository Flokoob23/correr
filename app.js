// Variables globales
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

// Inicializar mapa y capas
function initMap() {
  map = L.map("map", {
    zoomControl: false,
    minZoom: 3,
  }).setView([0, 0], 13);

  // Capas base
  const baseLayers = {
    "Calles": L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: "&copy; OSM" }
    ),

    "Satélite": L.tileLayer(
      "https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
      {
        maxZoom: 20,
        subdomains: ["mt0", "mt1", "mt2", "mt3"],
        attribution: "Google Satellite",
      }
    ),

    "Terreno": L.tileLayer(
      "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      { maxZoom: 17, attribution: "© OpenTopoMap" }
    ),
  };

  // Añadir capa calles por defecto
  baseLayers["Calles"].addTo(map);

  // Control de capas
  L.control.layers(baseLayers).addTo(map);
}

// Formatea segundos a hh:mm:ss
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// Formatea ritmo min/km a mm:ss
function formatPace(pace) {
  if (!pace || pace === Infinity) return "0:00";
  const min = Math.floor(pace);
  const sec = Math.round((pace - min) * 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

// Calcular distancia entre 2 puntos en metros con haversine
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Actualizar estadísticas en pantalla
function updateStats() {
  const now = Date.now();
  const elapsedSec = Math.floor((now - startTime) / 1000);
  timeEl.textContent = formatTime(elapsedSec);
  distanceEl.textContent = (distance / 1000).toFixed(2);

  // Ritmo = minutos por km = tiempo en minutos / distancia en km
  let pace = distance > 0 ? elapsedSec / 60 / (distance / 1000) : 0;
  paceEl.textContent = formatPace(pace);

  elevationEl.textContent = elevationGain.toFixed(0);
}

// Calcular desnivel positivo acumulado
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

// Parciales cada 1km
function checkSplits() {
  const km = Math.floor(distance / 1000);
  if (km > 0 && splits[splits.length - 1] !== km) {
    const now = Date.now();
    const elapsedSec = (now - startTime) / 1000;
    splits.push(km);

    // Mostrar parcial
    const li = document.createElement("li");
    li.textContent = `Km ${km} - Tiempo: ${formatTime(elapsedSec)}`;
    splitsEl.prepend(li);

    // Aviso visual
    alert(`Parcial ${km} km: ${formatTime(elapsedSec)}`);

    // Voz
    if ("speechSynthesis" in window) {
      const msg = new SpeechSynthesisUtterance(
        `Kilómetro ${km}, tiempo ${formatTime(elapsedSec)}`
      );
      window.speechSynthesis.speak(msg);
    }
  }
}

// Inicializar gráfico de elevación con Chart.js
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
        x: {
          display: false,
        },
        y: {
          ticks: { color: "#ffd600" },
          grid: { color: "#444" },
        },
      },
      plugins: {
        legend: {
          labels: { color: "#ffd600" },
        },
      },
    },
  });
}

// Actualizar gráfico con elevación
function updateChart() {
  if (!elevationChart) return;
  elevationChart.data.labels = pathCoords.map((_, i) => i);
  elevationChart.data.datasets[0].data = elevationData;
  elevationChart.update("none");
}

// Manejar nueva posición
function onPositionUpdate(pos) {
  const { latitude, longitude, altitude } = pos.coords;

  // Actualizar marcador o crearlo
  if (!userMarker) {
    userMarker = L.marker([latitude, longitude], {
      icon: L.icon({
        iconUrl:
          "https://cdn-icons-png.flaticon.com/512/64/64113.png",
        iconSize: [25, 25],
        iconAnchor: [12, 25],
      }),
    }).addTo(map);
  } else {
    userMarker.setLatLng([latitude, longitude]);
  }

  // Centrar mapa en la ubicación actual la primera vez
  if (pathCoords.length === 0) {
    map.setView([latitude, longitude], 15);
  }

  // Añadir nuevo punto
  const newPoint = [latitude, longitude];
  const newEle = altitude ?? 0;

  // Calcular distancia acumulada
  if (lastPosition) {
    const d = haversine(
      lastPosition[0],
      lastPosition[1],
      latitude,
      longitude
    );
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
    // Primer punto
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

// Manejar error de geolocalización
function onPositionError(err) {
  alert(
    "Error al obtener ubicación: " + err.message + ". Por favor, activa GPS y permisos."
  );
}

// Inicio y parada del tracking
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

    // Timer para actualizar tiempo cada segundo
    timerInterval = setInterval(updateStats, 1000);
  } else {
    // Detener tracking
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
  // Limpiar datos
  distance = 0;
  elevationGain = 0;
  pathCoords = [];
  elevationData = [];
  splits = [];
  lastPosition = null;
  splitsEl.innerHTML = "";
  updateStats();
  updateChart();

  // Quitar marcador y polyline
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

// Event listeners botones
startStopBtn.addEventListener("click", toggleTracking);
resetBtn.addEventListener("click", resetTracking);

// Inicializar mapa y gráfico
initMap();
initChart();
updateStats();
