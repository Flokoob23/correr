// ========== FLOKOOB GPS APP PRO - RECORRIDOS Y GIROS ==========

let map, userMarker, accuracyCircle, pathPolyline;
let chartPace, chartElev, chartSpeed;
let routePolyline, routeMarkers = [];
let routeMode = false;
let watchId = null, started = false, paused = false, timerInterval = null, voiceOn = true;
let kmVoiceNext = 1;
let nextTurnIndex = 0;
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
  lastVoiceKm: 0,
  route: [] // puntos {lat,lng}
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

function updateNextTurn(text, show) {
  const section = document.getElementById('nextTurn');
  const turnText = document.getElementById('turnText');
  if (show) {
    section.style.display = 'block';
    turnText.textContent = text;
  } else {
    section.style.display = 'none';
  }
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
  routePolyline = L.polyline([], {color:'#ff8000', weight:6, dashArray:'8,6', opacity:0.8}).addTo(map);
}

// ----------- USER MARKER -----------

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

// ----------- ROUTE CREATION -----------

function enableRouteMode() {
  routeMode = true;
  document.getElementById('routeBtn').disabled = true;
  document.getElementById('saveRouteBtn').style.display = '';
  document.getElementById('clearRouteBtn').style.display = '';
  speak('Modo de creación de recorrido activado. Haz clic en el mapa para marcar los puntos.');
  
  map.on('click', addRoutePoint);
}
function disableRouteMode() {
  routeMode = false;
  document.getElementById('routeBtn').disabled = false;
  document.getElementById('saveRouteBtn').style.display = 'none';
  document.getElementById('clearRouteBtn').style.display = 'none';
  map.off('click', addRoutePoint);
}

function addRoutePoint(e) {
  const latlng = e.latlng;
  state.route.push({lat: latlng.lat, lng: latlng.lng});
  drawRoute();
}

function drawRoute() {
  routePolyline.setLatLngs(state.route);
  // Remove old markers
  routeMarkers.forEach(m=>map.removeLayer(m));
  routeMarkers = [];
  // Draw numbered markers
  state.route.forEach((pt, i) => {
    const marker = L.marker(pt, {
      icon: L.divIcon({
        className: 'route-marker',
        html: `<div style="background:#ff8000;color:#fff;font-weight:bold;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:2px solid #fff800;">${i+1}</div>`,
        iconSize: [28,28],
        iconAnchor: [14,14]
      })
    });
    marker.addTo(map);
    routeMarkers.push(marker);
  });
}

function saveRoute() {
  disableRouteMode();
  speak('Recorrido guardado. Ya puedes iniciar tu actividad.');
}
function clearRoute() {
  state.route = [];
  drawRoute();
}

// ----------- TURN DETECTION -----------

function getTurnInstruction(from, to) {
  // Simple "doblar" indicación (izquierda/derecha/seguir) usando ángulo
  if (!from || !to) return "";
  // Calcula ángulo entre puntos (simplificado)
  const dx = to.lng - from.lng;
  const dy = to.lat - from.lat;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle > 30) return "Dobla a la izquierda";
  if (angle < -30) return "Dobla a la derecha";
  return "Sigue recto";
}

function checkUpcomingTurn(currentPos) {
  // Si hay una ruta creada y estamos cerca del siguiente punto, avisar
  if (!state.route || state.route.length < 2 || nextTurnIndex >= state.route.length-1) {
    updateNextTurn("", false);
    return;
  }
  const nextPt = state.route[nextTurnIndex+1];
  const distToTurn = calcDistance(currentPos, nextPt);
  if (distToTurn < 60 && distToTurn > 30) {
    // 50m antes del giro, avisar
    const from = state.route[nextTurnIndex];
    const to = state.route[nextTurnIndex+1];
    const instruction = getTurnInstruction(from, to);
    updateNextTurn(`${instruction} en ${Math.round(distToTurn)} metros`);
    if(voiceOn) speak(`${instruction} en ${Math.round(distToTurn)} metros`);
  } else if (distToTurn <= 30) {
    // Ya llegó al punto, pasar al siguiente
    nextTurnIndex++;
    updateNextTurn("", false);
  } else {
    updateNextTurn("", false);
  }
}

// ----------- GPS -----------

async function onLocation(pos) {
  const lat = pos.coords.latitude, lng = pos.coords.longitude;
  const accuracy = pos.coords.accuracy || 20;
  const coord = {lat, lng};
  let elev = pos.coords.altitude;
  if (elev == null) elev = await getElevation(lat, lng);

  const now = Date.now();
  let addPoint = true;
  if (state.positions.length > 0) {
    const lastPos = state.positions[state.positions.length-1];
    const lastTime = state.times[state.times.length-1];
    const dist = calcDistance(lastPos, coord); // metros
    const timeDelta = (Math.round((now-state.startTime)/1000)) - lastTime; // segundos
    const vel = dist / (timeDelta > 0 ? timeDelta : 1); // m/s

    // Filtro de saltos anómalos
    if (dist > 30 && vel > 6) {
      addPoint = false;
    }
  }

  if (addPoint) {
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

    // Turn guidance
    checkUpcomingTurn(coord);

    // ------ AVISOS DE VOZ ------
    const distKm = state.distances[state.distances.length-1]/1000;
    if (voiceOn && distKm >= kmVoiceNext) {
      speak(`Has recorrido ${kmVoiceNext} kilómetro${kmVoiceNext>1?'s':''}. Tiempo: ${formatTime(state.elapsed)}. Ritmo: ${calcPace(distKm,state.elapsed)} por kilómetro. ¡Sigue así!`);
      kmVoiceNext++;
      state.lastVoiceKm = kmVoiceNext-1;
    }
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
  nextTurnIndex = 0;
  if (pathPolyline) pathPolyline.setLatLngs([]);
  if (userMarker) map.removeLayer(userMarker), userMarker = null;
  if (accuracyCircle) map.removeLayer(accuracyCircle), accuracyCircle = null;
  updateStats();
  updateLaps();
  updateCharts();
  updateNextTurn("", false);
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
    updateNextTurn("", false);
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
  nextTurnIndex = 0;
  if (pathPolyline) pathPolyline.setLatLngs([]);
  if (userMarker) map.removeLayer(userMarker), userMarker = null;
  if (accuracyCircle) map.removeLayer(accuracyCircle), accuracyCircle = null;
  updateStats();
  updateLaps();
  updateCharts();
  updateNextTurn("", false);
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

document.getElementById('routeBtn').onclick = function() {
  enableRouteMode();
};
document.getElementById('saveRouteBtn').onclick = function() {
  saveRoute();
};
document.getElementById('clearRouteBtn').onclick = function() {
  clearRoute();
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
