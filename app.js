// ========== FLOKOOB GPS APP ==========

// -----------------------
// GLOBALS & STATE
// -----------------------
let map, userMarker, pathPolyline, elevChart;
let watchId = null;
let started = false;
let paused = false;
let timerInterval = null;

const state = {
  positions: [],
  times: [],
  distances: [],
  elevations: [],
  laps: [],
  startTime: null,
  elapsed: 0, // Seconds
  elevGain: 0,
  elevLoss: 0
};

// -----------------------
// HELPERS
// -----------------------

function formatTime(sec) {
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  return (h>0?String(h).padStart(2,'0')+':':'') +
         String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

function calcDistance(pos1, pos2) {
  // Haversine formula, returns distance in meters
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

async function getElevation(lat, lng) {
  // Use Open-Elevation API (free, but limited)
  try {
    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.results[0].elevation;
  } catch {
    return null;
  }
}

// -----------------------
// UI UPDATE FUNCTIONS
// -----------------------

function updateStats() {
  const dist = state.distances.length > 0 ? state.distances[state.distances.length-1] : 0;
  const distKm = dist / 1000;
  document.getElementById('distance').textContent = distKm.toFixed(2);
  document.getElementById('time').textContent = formatTime(state.elapsed);
  document.getElementById('pace').textContent = (distKm>0 ? calcPace(distKm, state.elapsed) : '0:00');
  document.getElementById('elev').textContent = 
    `${Math.round(state.elevGain)}↑ ${Math.round(state.elevLoss)}↓`;
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

function updateChart() {
  if (!elevChart) return;
  const labels = state.times.map(t=>formatTime(t));
  const paces = state.distances.map((d,i)=>{
    const distKm = d/1000;
    return distKm>0 ? state.times[i]/distKm/60 : 0;
  });
  elevChart.data.labels = labels;
  elevChart.data.datasets[0].data = paces;
  elevChart.update();
}

// -----------------------
// GPS & MAP FUNCTIONS
// -----------------------

function initMap() {
  map = L.map('map', {zoomControl: false, attributionControl:false}).setView([0,0], 15);

  // Map layers
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OSM'
  });
  const dark = L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, attribution: '© Stadia Maps'
  });
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: '© Esri'
  });

  const baseMaps = {
    "Negro": dark,
    "Callejero": osm,
    "Satélite": satellite
  };
  dark.addTo(map);

  L.control.layers(baseMaps, null, {position:'topright'}).addTo(map);

  pathPolyline = L.polyline([], {color:'#ffd600', weight:6, opacity:0.9}).addTo(map);
}

async function onLocation(pos) {
  const lat = pos.coords.latitude, lng = pos.coords.longitude;
  const coord = {lat, lng};

  // Elevation
  let elev = pos.coords.altitude;
  if (elev === null) {
    elev = await getElevation(lat, lng);
  }

  // Add point to path
  const now = Date.now();
  let delta = 0;
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
    state.elevations.push(elev);
  } else {
    state.distances.push(0);
    state.times.push(0);
    state.elevations.push(elev);
  }
  state.positions.push(coord);

  // Update marker and path
  if (userMarker) {
    userMarker.setLatLng(coord);
  } else {
    userMarker = L.marker(coord, {icon: L.icon({
      iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
      iconSize: [32,32], iconAnchor: [16,32]
    })}).addTo(map);
  }
  pathPolyline.setLatLngs(state.positions);

  // Center map
  if (state.positions.length===1 || state.positions.length%5===0)
    map.setView(coord, 16);

  updateStats();
  updateChart();
}

function handleError(err) {
  alert("No se pudo obtener tu ubicación.\nActiva el GPS y otorga permisos.\n\n"+err.message);
}

// -----------------------
// TIMER FUNCTIONS
// -----------------------

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(()=>{
    if (!paused) {
      state.elapsed = Math.round((Date.now() - state.startTime)/1000);
      updateStats();
    }
  }, 1000);
}

// -----------------------
// BUTTONS & EVENTS
// -----------------------

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
  state.laps = [];
  state.elevGain = 0;
  state.elevLoss = 0;
  if (pathPolyline) pathPolyline.setLatLngs([]);
  if (userMarker) map.removeLayer(userMarker), userMarker = null;
  updateStats();
  updateLaps();
  updateChart();
  this.disabled = true;
  document.getElementById('pauseBtn').disabled = false;
  document.getElementById('lapBtn').disabled = false;
  document.getElementById('resetBtn').disabled = false;
  // Start GPS
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(onLocation, handleError, {
      enableHighAccuracy: true, maximumAge: 1000, timeout:10000
    });
  } else {
    alert("Tu navegador no soporta geolocalización.");
  }
  startTimer();
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
  } else {
    this.textContent = 'Pausa';
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(onLocation, handleError, {
        enableHighAccuracy: true, maximumAge: 1000, timeout:10000
      });
    }
    state.startTime = Date.now() - state.elapsed*1000;
    startTimer();
  }
};

document.getElementById('lapBtn').onclick = function() {
  if (!started) return;
  const lastDist = state.distances.length>0 ? state.distances[state.distances.length-1] : 0;
  const lastTime = state.times.length>0 ? state.times[state.times.length-1] : 0;
  state.laps.push({dist: lastDist/1000, time: lastTime});
  updateLaps();
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
  state.elapsed = 0;
  state.elevGain = 0;
  state.elevLoss = 0;
  if (pathPolyline) pathPolyline.setLatLngs([]);
  if (userMarker) map.removeLayer(userMarker), userMarker = null;
  updateStats();
  updateLaps();
  updateChart();
  document.getElementById('startBtn').disabled = false;
  document.getElementById('pauseBtn').disabled = true;
  document.getElementById('lapBtn').disabled = true;
  document.getElementById('resetBtn').disabled = true;
  document.getElementById('pauseBtn').textContent = 'Pausa';
};

// -----------------------
// INIT
// -----------------------

window.onload = function() {
  initMap();
  // Chart.js for pace
  const ctx = document.getElementById('paceChart').getContext('2d');
  elevChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Min/km',
        data: [],
        borderColor: '#ffd600',
        backgroundColor: 'rgba(255,214,0,0.08)',
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
  updateStats();
  updateLaps();
};

