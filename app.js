// Estado global
let watchId = null;
let running = false;
let positions = [];
let totalDistance = 0; // en metros
let startTime = null;
let elapsedTime = 0; // ms
let timerInterval = null;

const KM_NOTIFY_DIST = 100; // cada 100 metros notify y guardar

// DOM
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const timeEl = document.getElementById('time');
const distanceEl = document.getElementById('distance');
const paceEl = document.getElementById('pace');

const statsSection = document.getElementById('statsSection');
const mapSection = document.getElementById('mapSection');

const kmModal = document.getElementById('kmModal');
const modalTime = document.getElementById('modalTime');
const closeKmModalBtn = document.getElementById('closeKmModal');

const finishModal = document.getElementById('finishModal');
const finalDistanceEl = document.getElementById('finalDistance');
const finalTimeEl = document.getElementById('finalTime');
const finalPaceEl = document.getElementById('finalPace');
const closeFinishModalBtn = document.getElementById('closeFinishModal');

const kmHistoryList = document.getElementById('kmHistoryList');
const historySection = document.getElementById('historySection');

const mapEl = document.getElementById('map');
const map = L.map(mapEl).setView([0, 0], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:
    '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

let polyline = L.polyline([], { color: '#ffcc00', weight: 6, opacity: 0.85 }).addTo(map);
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
// Calcula velocidad km/h
function calculateSpeed(distanceMeters, timeMs) {
  if (timeMs === 0) return 0;
  return (distanceMeters / 1000) / (timeMs / 3600000);
}

// Actualiza UI con datos
function updateDisplay() {
  distanceEl.textContent = (totalDistance / 1000).toFixed(2) + ' km';
  timeEl.textContent = msToTime(elapsedTime);
  paceEl.textContent = calculatePace(totalDistance, elapsedTime) + ' min/km';
}

// Guarda sesión parcial
function saveKmSession(kmNumber, timeMs) {
  const session = {
    km: kmNumber,
    time: msToTime(timeMs),
  };
  const kmSessions = JSON.parse(localStorage.getItem('kmSessions')) || [];
  kmSessions.push(session);
  localStorage.setItem('kmSessions', JSON.stringify(kmSessions));
  renderKmHistory();
}

// Render historial parcial
function renderKmHistory() {
  const kmSessions = JSON.parse(localStorage.getItem('kmSessions')) || [];
  if (kmSessions.length === 0) {
    historySection.classList.add('hidden');
    kmHistoryList.innerHTML = '';
    return;
  }
  historySection.classList.remove('hidden');
  kmHistoryList.innerHTML = '';
  kmSessions.forEach((session) => {
    const li = document.createElement('li');
    li.textContent = `Km ${session.km} - Tiempo: ${session.time}`;
    kmHistoryList.appendChild(li);
  });
}

// Modal km parcial
function openKmModal(timeText) {
  modalTime.textContent = timeText;
  kmModal.setAttribute('aria-hidden', 'false');
  kmModal.focus();
  speakText(`Kilómetro completado en ${timeText}`);
}
function closeKmModal() {
  kmModal.setAttribute('aria-hidden', 'true');
}
closeKmModalBtn.addEventListener('click', closeKmModal);

// Modal final
function openFinishModal() {
  finalDistanceEl.textContent = (totalDistance / 1000).toFixed(2) + ' km';
  finalTimeEl.textContent = msToTime(elapsedTime);
  finalPaceEl.textContent = calculatePace(totalDistance, elapsedTime) + ' min/km';
  finishModal.setAttribute('aria-hidden', 'false');
  finishModal.focus();
  speakText(`Carrera terminada. Distancia: ${(totalDistance / 1000).toFixed(2)} kilómetros. Tiempo total ${msToTime(elapsedTime)}`);
}
function closeFinishModalFunc() {
  finishModal.setAttribute('aria-hidden', 'true');
}
closeFinishModalBtn.addEventListener('click', closeFinishModalFunc);

// Síntesis de voz para feedback
function speakText(text) {
  if (!window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-AR';
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// Variables para distancia km
let lastKmNotified = 0;

// Botones activados/desactivados
function toggleButtons(isRunning) {
  startBtn.disabled = isRunning;
  pauseBtn.disabled = !isRunning;
  resetBtn.disabled = !isRunning;
}

// Empieza carrera
function startRunning() {
  if (!navigator.geolocation) {
    alert('Tu navegador no soporta geolocalización.');
    return;
  }
  if (running) return;

  running = true;
  lastKmNotified = 0;
  positions = [];
  totalDistance = 0;
  elapsedTime = 0;
  startTime = Date.now();

  polyline.setLatLngs([]);
  if (marker) {
    map.removeLayer(marker);
    marker = null;
  }

  statsSection.classList.remove('hidden');
  mapSection.classList.remove('hidden');

  watchPosition();
  startTimer();
  toggleButtons(true);
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
}

// Reiniciar carrera y mostrar modal final
function resetRunning() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  running = false;
  stopTimer();

  // Mostrar modal resumen si hubo distancia y tiempo
  if (totalDistance > 10 && elapsedTime > 30000) {
    openFinishModal();
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
  statsSection.classList.add('hidden');
  mapSection.classList.add('hidden');
  kmModal.setAttribute('aria-hidden', 'true');
  finishModal.setAttribute('aria-hidden', 'true');
  historySection.classList.add('hidden');
  kmHistoryList.innerHTML = '';
  localStorage.removeItem('kmSessions');

  updateDisplay();
  toggleButtons(false);
}

// Actualiza posición GPS
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

        if (dist > 1) {
          totalDistance += dist;
          positions.push(newPos);
          polyline.addLatLng(newPos);

          if (marker) {
            marker.setLatLng(newPos);
          } else {
            marker = L.marker(newPos, { interactive: false }).addTo(map);
          }
          map.panTo(newPos, { animate: true });

          // Revisar cada 100m si pasó km parcial
          let kmCompleted = Math.floor(totalDistance / KM_NOTIFY_DIST);
          if (kmCompleted > lastKmNotified) {
            lastKmNotified = kmCompleted;
            const timeSinceStart = Date.now() - startTime;
            saveKmSession(kmCompleted, timeSinceStart);
            openKmModal(msToTime(timeSinceStart));
          }

          updateDisplay();
        }
      } else {
        positions.push(newPos);
        polyline.addLatLng(newPos);
        map.setView(newPos, 15);
        marker = L.marker(newPos, { interactive: false }).addTo(map);
        updateDisplay();
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
      maximumAge: 500,
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

// Cerrar modales
function setupModalAccessibility() {
  // Cerrar modal km modal con ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (kmModal.getAttribute('aria-hidden') === 'false') closeKmModal();
      if (finishModal.getAttribute('aria-hidden') === 'false')
        closeFinishModalFunc();
    }
  });
}
setupModalAccessibility();

// Al iniciar app, cargar historial de km
window.onload = () => {
  renderKmHistory();
  toggleButtons(false);
  updateDisplay();
};

