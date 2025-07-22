// Estado app
let watchId = null;
let running = false;
let positions = [];
let totalDistance = 0; // metros
let startTime = null;
let elapsedTime = 0; // ms
let timerInterval = null;

// DOM
const distanceEl = document.getElementById('distance');
const timeEl = document.getElementById('time');
const paceEl = document.getElementById('pace');
const speedEl = document.getElementById('speed');
const altitudeEl = document.getElementById('altitude');

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const centerMapBtn = document.getElementById('centerMapBtn');

const historyList = document.getElementById('historyList');

const mapEl = document.getElementById('map');
const map = L.map(mapEl).setView([0, 0], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:
    '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

let polyline = L.polyline([], { color: '#ffcc00', weight: 5 }).addTo(map);
let marker = null;

// --- Funciones auxiliares ---
function deg2rad(deg) {
  return deg * (Math.PI / 180);
}
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
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
function calculatePace(distanceMeters, timeMs) {
  if (distanceMeters === 0) return '0:00';
  let pace = timeMs / (distanceMeters / 1000);
  let paceMin = Math.floor(pace / 60000);
  let paceSec = Math.floor((pace % 60000) / 1000);
  return paceMin + ':' + String(paceSec).padStart(2, '0');
}
function calculateSpeed(distanceMeters, timeMs) {
  if (timeMs === 0) return 0;
  return (distanceMeters / 1000) / (timeMs / 3600000);
}
// Actualiza display en pantalla
function updateDisplay() {
  distanceEl.textContent = (totalDistance / 1000).toFixed(2) + ' km';
  timeEl.textContent = msToTime(elapsedTime);
  paceEl.textContent = calculatePace(totalDistance, elapsedTime) + ' min/km';
  speedEl.textContent = calculateSpeed(totalDistance, elapsedTime).toFixed(1) + ' km/h';
}

// Guarda estado en localStorage
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
    positions = parsed.positions || [];
    totalDistance = parsed.totalDistance || 0;
    startTime = parsed.startTime;
    elapsedTime = parsed.elapsedTime || 0;

    // Restaurar ruta en mapa
    polyline.setLatLngs(positions);
    if (positions.length) {
      const lastPos = positions[positions.length - 1];
      if (marker) marker.setLatLng(lastPos);
      else marker = L.marker(lastPos).addTo(map);
      map.setView(lastPos, 15);
    }

    updateDisplay();

    if (running) {
      startTimer();
      watchPosition();
      toggleButtons(true);
    } else {
      toggleButtons(false);
    }
  }
}

// Botones activados/desactivados
function toggleButtons(isRunning) {
  startBtn.disabled = isRunning;
  pauseBtn.disabled = !isRunning;
  resetBtn.disabled = false;
}

// Inicia cronómetro y GPS
function startRunning() {
  if (!navigator.geolocation) {
    alert('Tu navegador no soporta geolocalización.');
    return;
  }
  if (running) return;

  running = true;
  startTime = Date.now() - elapsedTime;
  startTimer();
  watchPosition();
  toggleButtons(true);
  notifyStatus('Carrera iniciada');
  saveState();
}

// Pausar carrera
function pauseRunning() {
  if (!running) return;
  running = false;
  stopTimer();
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  toggleButtons(false);
  notifyStatus('Carrera pausada');
  saveState();
}

// Reiniciar carrera
function resetRunning() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  running = false;

  // Guardar sesión si hubo distancia y tiempo
  if (totalDistance > 10 && elapsedTime > 30000) {
    saveSession();
  }

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
  notifyStatus('Carrera reiniciada');
  saveState();
}

// Observa posición GPS en tiempo real
function watchPosition() {
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, altitude } = pos.coords;
      const newPos = [latitude, longitude];
      if (altitude !== null && altitude !== undefined) {
        altitudeEl.textContent = Math.round(altitude) + ' m';
      } else {
        altitudeEl.textContent = '-- m';
      }

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
        'Error al obtener posición GPS. Revisa permisos o la señal del GPS.'
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

// Centrar mapa en la última posición
function centerMap() {
  if (positions.length) {
    map.setView(positions[positions.length - 1], 15, {
      animate: true,
    });
  }
}

// Notificaciones visuales (simples)
function notifyStatus(msg) {
  const notif = document.createElement('div');
  notif.className = 'notif';
  notif.textContent = msg;
  document.body.appendChild(notif);
  setTimeout(() => {
    notif.classList.add('show');
  }, 10);
  setTimeout(() => {
    notif.classList.remove('show');
    setTimeout(() => notif.remove(), 300);
  }, 2200);
}

// Guardar sesión al terminar (en localStorage)
function saveSession() {
  const sessions = JSON.parse(localStorage.getItem('runningAppSessions')) || [];
  const session = {
    date: new Date().toLocaleString(),
    distance: (totalDistance / 1000).toFixed(2),
    duration: msToTime(elapsedTime),
    pace: calculatePace(totalDistance, elapsedTime),
    speed: calculateSpeed(totalDistance, elapsedTime).toFixed(1),
  };
  sessions.unshift(session);
  if (sessions.length > 20) sessions.pop(); // limitar historial a 20 sesiones
  localStorage.setItem('runningAppSessions', JSON.stringify(sessions));
  renderHistory();
}

// Renderizar historial de sesiones
function renderHistory() {
  const sessions = JSON.parse(localStorage.getItem('runningAppSessions')) || [];
  historyList.innerHTML = '';
  if (!sessions.length) {
    historyList.innerHTML =
      '<li>No hay sesiones guardadas. Corre para empezar a registrar.</li>';
    return;
  }
  sessions.forEach((s, i) => {
    const li = document.createElement('li');
    li.title = `Fecha: ${s.date}`;
    li.textContent = `${s.date.split(',')[0]} — Distancia: ${s.distance} km — Tiempo: ${s.duration} — Ritmo: ${s.pace} min/km — Vel: ${s.speed} km/h`;
    historyList.appendChild(li);
  });
}

// Eventos botones
startBtn.addEventListener('click', startRunning);
pauseBtn.addEventListener('click', pauseRunning);
resetBtn.addEventListener('click', resetRunning);
centerMapBtn.addEventListener('click', centerMap);

// Al cargar app
window.onload = () => {
  loadState();
  renderHistory();
};

// Notificaciones estilo (agregar a styles.css dinámicamente)
const style = document.createElement('style');
style.textContent = `
  .notif {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(30px);
    background: #ffcc00dd;
    color: #121212;
    padding: 12px 22px;
    border-radius: 30px;
    font-weight: 600;
    box-shadow: 0 0 10px #ffcc00cc;
    opacity: 0;
    pointer-events: none;
    user-select: none;
    transition: all 0.3s ease;
    z-index: 1000;
  }
  .notif.show {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
    pointer-events: auto;
  }
`;
document.head.appendChild(style);

