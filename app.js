// app.js

// Variables de estado
let watchId = null;
let isRunning = false;
let startTime = 0;
let elapsedTime = 0;
let timerInterval = null;

let positions = [];
let distance = 0;
let lastKmMark = 0;

const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const resetButton = document.getElementById('resetButton');
const timerDisplay = document.getElementById('timer');
const distanceDisplay = document.getElementById('distance');
const paceDisplay = document.getElementById('pace');
const totalTimeDisplay = document.getElementById('totalTime');
const logList = document.getElementById('logList');
const mapElement = document.getElementById('map');

let map, polyline;

// Inicialización del mapa
function initMap() {
  map = L.map('map').setView([0, 0], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  polyline = L.polyline([], { color: '#ffe600', weight: 5 }).addTo(map);
}

// Formatea milisegundos a HH:MM:SS
function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds - hours * 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
}

// Calcula distancia entre dos coordenadas (Haversine)
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}

// Actualiza estadísticas en pantalla
function updateStats() {
  distanceDisplay.textContent = distance.toFixed(2);
  totalTimeDisplay.textContent = formatTime(elapsedTime);

  if (distance > 0) {
    const paceMinutes = (elapsedTime / 60000) / distance;
    const paceMin = Math.floor(paceMinutes);
    const paceSec = Math.floor((paceMinutes - paceMin) * 60);
    paceDisplay.textContent = `${paceMin}:${paceSec.toString().padStart(2,'0')}`;
  } else {
    paceDisplay.textContent = '0:00';
  }
}

// Agrega punto al mapa y actualiza ruta
function addPosition(lat, lng) {
  positions.push([lat, lng]);
  polyline.setLatLngs(positions);
  map.panTo([lat, lng]);
}

// Maneja la posición recibida por geolocalización
function handlePosition(position) {
  const { latitude, longitude } = position.coords;

  if (positions.length > 0) {
    const [lastLat, lastLng] = positions[positions.length-1];
    const segmentDistance = haversine(lastLat, lastLng, latitude, longitude);
    distance += segmentDistance;

    // Aviso por voz cada km completo
    if (distance - lastKmMark >= 1) {
      lastKmMark = Math.floor(distance);
      speak(`Kilómetro ${lastKmMark} completado`);
    }
  } else {
    map.setView([latitude, longitude], 15);
  }

  addPosition(latitude, longitude);
  updateStats();
}

// Controla el temporizador
function startTimer() {
  startTime = Date.now() - elapsedTime;
  timerInterval = setInterval(() => {
    elapsedTime = Date.now() - startTime;
    updateStats();
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// Guarda sesión en historial localStorage
function saveSession() {
  if (distance < 0.01) return; // Ignorar sesiones insignificantes

  const session = {
    date: new Date().toLocaleString(),
    distance: distance.toFixed(2),
    duration: formatTime(elapsedTime),
    pace: paceDisplay.textContent,
  };

  let history = JSON.parse(localStorage.getItem('flokoob_history')) || [];
  history.unshift(session);
  if (history.length > 50) history.pop(); // Limita a últimas 50 sesiones

  localStorage.setItem('flokoob_history', JSON.stringify(history));
  renderHistory();
}

// Renderiza historial en UI
function renderHistory() {
  let history = JSON.parse(localStorage.getItem('flokoob_history')) || [];
  logList.innerHTML = '';
  if (history.length === 0) {
    logList.innerHTML = '<li>No hay registros aún.</li>';
    return;
  }

  history.forEach(s => {
    const li = document.createElement('li');
    li.textContent = `${s.date} - ${s.distance} km en ${s.duration} (Ritmo: ${s.pace})`;
    logList.appendChild(li);
  });
}

// Voz para avisos
function speak(text) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    speechSynthesis.speak(utterance);
  }
}

// Eventos de botones
startButton.addEventListener('click', () => {
  if (isRunning) return;
  isRunning = true;
  lastKmMark = 0;
  distance = 0;
  elapsedTime = 0;
  positions = [];
  polyline.setLatLngs([]);
  timerDisplay.classList.add('running');

  // Inicia geolocalización
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(handlePosition, err => {
      alert('Error al obtener ubicación: ' + err.message);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  } else {
    alert('Geolocalización no soportada por el navegador');
  }

  startTimer();

  startButton.disabled = true;
  stopButton.disabled = false;
});

stopButton.addEventListener('click', () => {
  if (!isRunning) return;

  isRunning = false;
  timerDisplay.classList.remove('running');
  stopTimer();

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  saveSession();

  startButton.disabled = false;
  stopButton.disabled = true;
});

resetButton.addEventListener('click', () => {
  if (isRunning) {
    alert('Primero detenga el entrenamiento');
    return;
  }
  distance = 0;
  elapsedTime = 0;
  positions = [];
  polyline.setLatLngs([]);
  updateStats();
  timerDisplay.textContent = '00:00:00';
});

// Inicialización
window.onload = () => {
  initMap();
  renderHistory();
  stopButton.disabled = true;
  timerDisplay.textContent = '00:00:00';
};
