// ========== FLOKOOB GPS APP PRO ==========
let map, userMarker, accuracyCircle, pathPolyline;
let chartPace, chartElev, chartSpeed;
let watchId = null, started = false, paused = false, timerInterval = null, voiceOn = true;
let kmVoiceNext = 1;
const state = {
  positions: [],
  times: [],
  distances: [],
  elevations: [],
  speeds: [],
  laps: [],
  startTime: null,
  elapsed: 0, // seconds
  elevGain: 0,
  elevLoss: 0,
  lastElev: 0,
  lastVoiceKm: 0
};

// ----------- HELPERS -----------

function formatTime(sec) {
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  return (h>0?String(h).padStart(2,'0')+':':'') +
         String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

function calcDistance(pos1, pos2) {
  // Haversine
  const toRad = x => x * Math.PI / 180;
  const R = 6371e3;
  const dLat = toRad(pos2.lat - pos1.lat);
  const dLon = toRad(pos2.lng - pos1.lng);
  const a =
    Math.sin(dLat/2) ** 2 +
    Math.cos(toRad(pos1.lat)) * Math.cos(toRad(pos2.lat)) *
    Math.sin(dLon/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function calcPace(distKm, sec) {
  if (distKm === 0) return '0:00';
  const pace = sec / distKm;
  const min = Math.floor(pace/60);
  const secd = Math.round(pace%60);
  return `${min}:${String(secd).padStart(2,'0')}`;
}

function getSpeed(last, now, tdelta) {
  if (!last || !now || tdelta === 0) return 0;
  const d = calcDistance(last, now);
  return (d/tdelta)*3.6; // m/s to km/h
}

async function getElevation(lat, lng) {
  try {
    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.results[0].elevation;
  } catch {
    return null;
  }
}

// ----------- VOICE -----------

function speak(text) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const msg = new SpeechSynthesisUtterance(text);
  msg.lang = "es-ES";
  msg.rate = 1;
  window.speechSynthesis.speak(msg);
}

// ----------- UI UPDATES -----------

function updateStats() {
  const dist = state.distances.length > 0 ? state.distances[state.distances.length-1] : 0;
  const distKm = dist / 1000;
  const speed = state.speeds.length > 0 ? state.speeds[state.speeds.length-1] : 0;
  document.getElementById('distance').textContent = distKm.toFixed(2);
  document.getElementById('time').textContent = formatTime(state.elapsed);
  document.getElementById('pace').textContent = (distKm>0 ? calcPace(distKm, state.elapsed) : '0:00');
  document.getElementById('speed').textContent = speed.toFixed(1);
  document.getElementById('elev').textContent = `${Math.round(state.elevGain)}↑ ${Math.round(state.elevLoss)}↓`;
  document.getElementById('current-elev').textContent = state.lastElev ? Math.round(state.lastElev) : '0';
}

function updateLaps() {
  const ul = document.getElementById('lapsList');
  ul.innerHTML = '';
  if (state.laps.length === 0) {
    ul.innerHTML = '<li style="color:#888">Ningún parcial aún.</li>';
  } else {
    state.laps.forEach((lap,i) => {
      ul.innerHTML += `<li>Parcial ${i+1}: ${formatTime(lap.time)} - ${lap.dist.toFixed(2)} km</li>`;
    });
  }
}

function updateCharts() {
  if (!chartPace || !chartElev || !chartSpeed) return;
  const labels = state.times.map(t=>formatTime(t));
  // Ritmo
  const paces = state.distances.map((d,i)=>{
    const distKm = d/1000;
    return distKm>0 ? state.times[i]/distKm : 0;
  });
  // Elevación
  const elevs = state.elevations.map(e=>e?e:0);
  // Velocidad
  const speeds = state.speeds.map(v=>v);

  chartPace.data.labels = labels;
  chartPace.data.datasets[0].data = paces;
  chartPace.update('none');
  chartElev.data.labels = labels;
  chartElev.data.datasets[0].data = elevs;
  chartElev.update('none');
  chartSpeed.data.labels = labels;
  chartSpeed.data.datasets[0].data = speeds;
  chartSpeed.update('none');
}

// ----------- MAP -----------

function initMap() {
  map = L.map('map', {zoomControl: false, attributionControl:false}).setView([0,0], 15);

  // Capas
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19});
  const dark = L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {maxZoom: 19});
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom: 19});
  const baseMaps = {
    "Negro": dark,
    "Callejero": osm,
    "Satélite": satellite
  };
  dark.addTo(map);
  L.control.layers(baseMaps, null, {position:'topright'}).addTo(map);

  pathPolyline = L.polyline([], {color:'#ffd600', weight:7, opacity:0.93}).addTo(map);
}

function updateUserMarker(coord, accuracy=20) {
  if (userMarker) {
    userMarker.setLatLng(coord);
    if (accuracyCircle) accuracyCircle.setLatLng(coord).setRadius(accuracy);
  } else {
    userMarker = L.marker(coord, {
      icon: L.icon({
        iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
        iconSize: [38,38], iconAnchor: [19,38], className: 'gps-marker'
      })
    }).addTo(map);
    accuracyCircle = L.circle(coord, {
      color: "#ffd600aa",
      fillColor: "#ffd60033",
      fillOpacity: 0.5,
      radius: accuracy
    }).addTo(map);
  }
}

// ----------- GPS -----------

async function onLocation(pos) {
  const lat = pos.coords.latitude, lng = pos.coords.longitude;
  const accuracy = pos.coords.accuracy || 20;
  const coord = {lat, lng};
  // Elevation
  let elev = pos.coords.altitude;
  if (elev == null) {
    elev = await getElevation(lat, lng);
  }
  // Add point
  const now = Date.now();
  let delta = 0, tdelta = 1, spd = 0;
  if (state.positions.length > 0) {
    delta = calcDistance(state.positions[state.positions.length-1], coord);
    state.distances.push(state.distances[state.distances.length-1] + delta);
    state.times.push(Math.round((now - state.startTime)/1000));
    // Elevation gain/loss
    const prevElev = state.elevations[state.elevations.length-1];
    if (elev !== null && prevElev !== null) {
      if (elev > prevElev) state.elevGain += elev-prevElev;
      else state.elevLoss += prevElev-elev;
    }
    // Speed (km/h)
    tdelta = (state.times.length>1) ? (state.times[state.times.length-1]-state.times[state.times.length-2]) : 1;
    spd = getSpeed(state.positions[state.positions.length-1], coord, tdelta);
    state.speeds.push(spd);
    state.elevations.push(elev);
  } else {
    state.distances.push(0);
    state.times.push(0);
    state.elevations.push(elev);
    state.speeds.push(0);
  }
  state.positions.push(coord);
  state.lastElev = elev;

  // Update marker & path
  updateUserMarker(coord, accuracy);
  pathPolyline.setLatLngs(state.positions);

  // Center map on move
  if (state.positions.length===1 || state.positions.length%5===0)
    map.setView(coord, 16);

  updateStats();
  updateCharts();

  // ------ AVISOS DE VOZ ------
  const distKm = state.distances[state.distances.length-1]/1000;
  if (voiceOn && distKm >= kmVoiceNext) {
    speak(`Has recorrido ${kmVoiceNext} kilómetro${kmVoiceNext>1?'s':''}. Tiempo: ${formatTime(state.elapsed)}. Ritmo: ${calcPace(distKm,state.elapsed)} por kilómetro. ¡Sigue así!`);
    kmVoiceNext++;
    state.lastVoiceKm = kmVoiceNext-1;
  }
}

// ----------- TIMER -----------

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(()=>{
    if (!paused) {
      state.elapsed = Math.round((Date.now() - state.startTime)/1000);
      updateStats();
    }
  }, 1000);
}

// ----------- BOTONES -----------

document.getElementById('startBtn').onclick = function() {
  if (started) return;
  started = true;
  paused = false;
  state.startTime = Date.now();
  state.elapsed = 0;
  state.positions = [];
  state.distances = [];
  state.times = [];
  state.elevations = [];
  state.speeds = [];
  state.laps = [];
  state.elevGain = 0;
  state.elevLoss = 0;
  kmVoiceNext = 1;
  state.lastElev = 0;
  state.lastVoiceKm = 0;
  if (pathPolyline) pathPolyline.setLatLngs([]);
  if (userMarker) map.removeLayer(userMarker), userMarker = null;
  if (accuracyCircle) map.removeLayer(accuracyCircle), accuracyCircle = null;
  updateStats();
  updateLaps();
  updateCharts();
  this.disabled = true;
  document.getElementById('pauseBtn').disabled = false;
  document.getElementById('lapBtn').disabled = false;
  document.getElementById('resetBtn').disabled = false;
  // GPS
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(onLocation, handleError, {
      enableHighAccuracy: true, maximumAge: 1000, timeout:10000
    });
  } else {
    alert("Tu navegador no soporta geolocalización.");
  }
  startTimer();
  if(voiceOn) speak('Comenzando entrenamiento. ¡Vamos!');
};

document.getElementById('pauseBtn').onclick = function() {
  if (!started) return;
  paused = !paused;
  if (paused) {
    this.textContent = 'Seguir';
    if (watchId!==null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if(voiceOn) speak('Pausa. Puedes descansar.');
  } else {
    this.textContent = 'Pausa';
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(onLocation, handleError, {
        enableHighAccuracy: true, maximumAge: 1000, timeout:10000
      });
    }
    state.startTime = Date.now() - state.elapsed*1000;
    startTimer();
    if(voiceOn) speak('Reanudando. ¡Ánimo!');
  }
};

document.getElementById('lapBtn').onclick = function() {
  if (!started) return;
  const lastDist = state.distances.length>0 ? state.distances[state.distances.length-1] : 0;
  const lastTime = state.times.length>0 ? state.times[state.times.length-1] : 0;
  state.laps.push({dist: lastDist/1000, time: lastTime});
  updateLaps();
  if(voiceOn) speak(`Parcial ${state.laps.length}: ${formatTime(lastTime)} y ${lastDist/1000} kilómetros.`);
};

document.getElementById('resetBtn').onclick = function() {
  started = false;
  paused = false;
  if (timerInterval) clearInterval(timerInterval), timerInterval=null;
  if (watchId!==null) navigator.geolocation.clearWatch(watchId), watchId=null;
  state.positions = [];
  state.distances = [];
  state.times = [];
  state.elevations = [];
  state.laps = [];
  state.speeds = [];
  state.elapsed = 0;
  state.elevGain = 0;
  state.elevLoss = 0;
  kmVoiceNext = 1;
  state.lastElev = 0;
  state.lastVoiceKm = 0;
  if (pathPolyline) pathPolyline.setLatLngs([]);
  if (userMarker) map.removeLayer(userMarker), userMarker = null;
  if (accuracyCircle) map.removeLayer(accuracyCircle), accuracyCircle = null;
  updateStats();
  updateLaps();
  updateCharts();
  document.getElementById('startBtn').disabled = false;
  document.getElementById('pauseBtn').disabled = true;
  document.getElementById('lapBtn').disabled = true;
  document.getElementById('resetBtn').disabled = true;
  document.getElementById('pauseBtn').textContent = 'Pausa';
  if(voiceOn) speak('Entrenamiento reseteado. Listo para un nuevo desafío.');
};

document.getElementById('voiceBtn').onclick = function() {
  voiceOn = !voiceOn;
  this.textContent = voiceOn ? '🔊 Voz' : '🔇 Voz';
  if (voiceOn) speak('Voz activada');
  else window.speechSynthesis.cancel();
};

// ----------- ERROR -----------

function handleError(err) {
  alert("No se pudo obtener tu ubicación.\nActiva el GPS y otorga permisos.\n\n"+err.message);
}

// ----------- INIT -----------

window.onload = function() {
  initMap();
  // Chart.js para 3 gráficos
  const paceCtx = document.getElementById('paceChart').getContext('2d');
  chartPace = new Chart(paceCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Min/Km',
        data: [],
        borderColor: '#ffd600',
        backgroundColor: 'rgba(255,214,0,0.10)',
        tension: 0.35,
        fill: true,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {legend: {display:false}},
      scales: {
        x: {display:false},
        y: {
          beginAtZero: true,
          color: '#ffd600',
          grid: {color: '#333'},
          ticks: { color: "#ffd600"},
        }
      }
    }
  });
  const elevCtx = document.getElementById('elevChart').getContext('2d');
  chartElev = new Chart(elevCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Elevación',
        data: [],
        borderColor: '#bba500',
        backgroundColor: 'rgba(255,214,0,0.08)',
        tension: 0.3,
        fill: true,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {legend: {display:false}},
      scales: {
        x: {display:false},
        y: {
          beginAtZero: false,
          color: '#ffd600',
          grid: {color: '#333'},
          ticks: { color: "#ffd600"},
        }
      }
    }
  });
  const speedCtx = document.getElementById('speedChart').getContext('2d');
  chartSpeed = new Chart(speedCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Velocidad',
        data: [],
        borderColor: '#ffd600',
        backgroundColor: 'rgba(255,214,0,0.09)',
        tension: 0.32,
        fill: true,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {legend: {display:false}},
      scales: {
        x: {display:false},
        y: {
          beginAtZero: true,
          color: '#ffd600',
          grid: {color: '#333'},
          ticks: { color: "#ffd600"},
        }
      }
    }
  });
  updateStats();
  updateLaps();
  updateCharts();
};
