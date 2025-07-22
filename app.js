// Variables globales
let watchId = null;
let running = false;
let positions = [];
let totalDistance = 0; // en metros
let startTime = null;
let elapsedTime = 0; // en ms
let timerInterval = null;

// Elementos DOM
const distanceEl = document.getElementById('distance');
const timeEl = document.getElementById('time');
const paceEl = document.getElementById('pace');

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');

const mapEl = document.getElementById('map');

// Configuración mapa Leaflet
const map = L.map(mapEl).setView([0, 0], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:
    '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
let polyline = L.polyline([], { color: '#ffcc00' }).addTo(map);
let marker = null;

// --- Funciones auxiliares ---
// Calcula distancia entre dos puntos GPS usando fórmula Haversine
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // radio de la tierra en metros
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function deg2rad(deg) {
  return deg * (Math.PI / 180);
}
// Convierte ms a hh:mm:ss
function msToTime(duration) {
  let seconds = Math.floor((duration / 1000) % 60);
  let minutes = Math.floor((duration / (1000 * 60)) % 60);
  let hours = Math.floor(duration / (1000 * 60 * 60));

  return (
    String(hours).padStart(2, '0') +
    ':' +
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds).padStart(2, '0')
  );
}
// Calcula ritmo promedio (min/km)
function calculatePace(distanceMeters, timeMs) {
  if (distanceMeters === 0) return '0:00';
  let pace = timeMs / (distanceMeters / 1000); // ms por km
  let paceMin = Math.floor(pace / 60000);
  let paceSec = Math.floor((pace % 60000) / 1000);
  return paceMin + ':' + String(paceSec).padStart(2, '0');
}

// Actualiza pantalla
function updateDisplay() {
  distanceEl.textContent = (totalDistance / 1000).toFixed(2) + ' km';
  timeEl.textContent = msToTime(elapsedTime);
  paceEl.textContent = calculatePace(totalDistance, elapsedTime) + ' min/km';
}

// Guarda estado en localStorage para persistencia
function saveState() {
  const state = {
    running,
    positions,
    totalDistance,
    startTime,
    elapsedTime,
  };
  localStorage.setItem('runningAppState', JSON.stringify(state));
}

// Carga estado guardado
function loadState() {
  const state = localStorage.getItem('runningAppState');
  if (state) {
    const parsed = JSON.parse(state);
    running = parsed.running;
    positions = parsed.positions;
    totalDistance = parsed.totalDistance;
    startTime = parsed.startTime;
    elapsedTime = parsed.elapsedTime;

    // Actualiza mapa con posiciones previas
    polyline.setLatLngs(positions);
    if (positions.length > 0) {
      map.setView(positions[positions.length - 1], 15);
      if (marker) {
        marker.setLatLng(positions[positions.length - 1]);
      } else {
        marker = L.marker(positions[positions.length - 1]).addTo(map);
      }
    }

    updateDisplay();

    if (running) {
      startTimer();
      watchPosition();
      toggleButtons(true);
    }
  }
}

// Actualiza botones según estado
function toggleButtons(isRunning) {
  startBtn.disabled = isRunning;
  pauseBtn.disabled = !isRunning;
  resetBtn.disabled = false;
}

// Función para iniciar el GPS y timer
function startRunning() {
  if (!navigator.geolocation) {
    alert('Geolocalización no soportada por tu navegador');
    return;
  }
  if (running) return;

  running = true;
  startTime = Date.now() - elapsedTime;
  startTimer();
  watchPosition();
  toggleButtons(true);
  saveState();
}

// Función para pausar
function pauseRunning() {
  running = false;
  stopTimer();
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  toggleButtons(false);
  saveState();
}

// Función para reiniciar todo
function resetRunning() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  running = false;
  positions = [];
  totalDistance = 0;
  elapsedTime = 0;
  startTime = null;
  polyline.setLatLngs([]);
  if (marker) {
    map.removeLayer(marker);
    marker = null;
  }
  updateDisplay();
  toggleButtons(false);
  localStorage.removeItem('runningAppState');
}

// Maneja nuevas posiciones GPS
function watchPosition() {
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const newPos = [latitude, longitude];

      if (positions.length > 0) {
        const lastPos = positions[positions.length - 1];
        const dist = getDistanceFromLatLonInMeters(
          lastPos[0],
          lastPos[1],
          latitude,
          longitude
        );
        if (dist > 0.5) {
          totalDistance += dist;
          positions.push(newPos);
          polyline.addLatLng(newPos);

          if (marker) {
            marker.setLatLng(newPos);
          } else {
            marker = L.marker(newPos).addTo(map);
          }
          map.panTo(newPos);
          updateDisplay();
          saveState();
        }
      } else {
        positions.push(newPos);
        polyline.addLatLng(newPos);
        map.setView(newPos, 15);
        marker = L.marker(newPos).addTo(map);
        updateDisplay();
        saveState();
      }
    },
    (err) => {
      console.error('Error geolocalización:', err);
      alert(
        'Error al obtener posición GPS. Por favor revisa que tengas habilitado el GPS y permisos para la página.'
      );
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    }
  );
}

// Temporizador
function startTimer() {
  if (timerInterval) return;

  timerInterval = setInterval(() => {
    elapsedTime = Date.now() - startTime;
    updateDisplay();
  }, 1000);
}
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Eventos botones
startBtn.addEventListener('click', startRunning);
pauseBtn.addEventListener('click', pauseRunning);
resetBtn.addEventListener('click', resetRunning);

// Al cargar la app, cargar estado guardado
window.onload = () => {
  loadState();
};
