// FLOKOOB Running Pro Tracker - Profesional
const OWM_API_KEY = "TU_API_KEY_OPENWEATHERMAP";

// === ESTADO GLOBAL ===
let map, userMarker, accuracyCircle, pathPolyline, routePolyline, routeMarkers = [], routingControl = null, manualRouting = null;
let routeMode = false, autoRouteMode = false, manualRoutePoints = [];
let watchId = null, started = false, paused = false, timerInterval = null, voiceOn = true, kmVoiceNext = 1, realCoords = null;
const STORAGE_KEY = "flokoob_activities_v1";
const state = {
  positions: [], times: [], distances: [], elevations: [], speeds: [],
  laps: [], startTime: null, elapsed: 0, elevGain: 0, elevLoss: 0,
  lastElev: 0, lastVoiceKm: 0, route: [], autoRoute: [],
  routeTotalKm: 0, routeRemainingKm: 0
};

// === UTILIDADES UI ===
function showModal(text) {
  document.getElementById('modalText').innerHTML = text;
  document.getElementById('modalOverlay').style.display = 'flex';
}
function showQuickModal(text, ms=1900) {
  const qm = document.getElementById('quickModal');
  document.getElementById('quickModalText').innerText = text;
  qm.style.display = 'block';
  setTimeout(()=>{ qm.style.display = 'none'; }, ms);
}
function showSection(secId) {
  document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  document.getElementById(secId).classList.add('active');
}
function setActiveNav(navId) {
  Array.from(document.querySelectorAll('.nav-btn')).forEach(btn=>btn.classList.remove('active'));
  document.getElementById(navId).classList.add('active');
}

// === WEATHER ===
function emojiWeather(main, code, cloud, rain, snow) {
  if(code>=200 && code<300) return "⛈️";
  if(code>=300 && code<600) return "🌦️";
  if(code>=600 && code<700) return "❄️";
  if(main==="Clear") return "☀️";
  if(main==="Clouds" && cloud<30) return "🌤️";
  if(main==="Clouds" && cloud<60) return "⛅";
  if(main==="Clouds") return "☁️";
  if(main==="Rain" || main==="Drizzle") return "🌧️";
  if(main==="Thunderstorm") return "⛈️";
  return "🌡️";
}
function updateWeatherBar(lat, lon) {
  if(!OWM_API_KEY || OWM_API_KEY==="TU_API_KEY_OPENWEATHERMAP") {
    document.getElementById("weatherBar").innerText = "🌐";
    return;
  }
  fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OWM_API_KEY}&units=metric&lang=es`)
    .then(r=>r.json())
    .then(data=>{
      const emoji = emojiWeather(data.weather[0].main, data.weather[0].id, data.clouds.all, data.rain, data.snow);
      const txt = `${emoji} ${data.main.temp.toFixed(1)}°C ${data.weather[0].description}`;
      document.getElementById("weatherBar").innerText = txt;
    }).catch(()=>{ document.getElementById("weatherBar").innerText = "🌐"; });
}

// === BUSCADOR EN VIVO OSM ===
const searchInput = document.getElementById('searchInput');
const searchForm = document.getElementById('searchForm');
let searchDropdown = document.createElement('div');
searchDropdown.className = 'search-dropdown';
searchDropdown.style.display = 'none';
searchDropdown.style.position = 'absolute';
searchDropdown.style.zIndex = 1001;
searchInput.parentNode.appendChild(searchDropdown);

let searchTimer = null;
searchInput.oninput = function(e) {
  clearTimeout(searchTimer);
  let val = searchInput.value.trim();
  if (val.length < 2) {
    searchDropdown.style.display = 'none';
    return;
  }
  searchTimer = setTimeout(() => {
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=7&addressdetails=1`)
      .then(r=>r.json()).then(data=>{
        if(data.length === 0) {
          searchDropdown.innerHTML = '<div class="search-dropdown-item">Sin resultados</div>';
          searchDropdown.style.display = 'block';
        } else {
          searchDropdown.innerHTML = data.map((item, idx) => `
            <div class="search-dropdown-item" data-lat="${item.lat}" data-lon="${item.lon}">
              <span class="search-main">${item.display_name.split(",")[0]}</span>
              <span class="search-addr">${item.display_name.slice(item.display_name.indexOf(",")+1).trim()}</span>
            </div>
          `).join('');
          searchDropdown.style.display = 'block';
          Array.from(searchDropdown.children).forEach(item => {
            item.onclick = function() {
              const lat = parseFloat(item.getAttribute('data-lat'));
              const lon = parseFloat(item.getAttribute('data-lon'));
              map.setView([lat, lon], 16, {animate:true});
              showQuickModal('📍 '+item.querySelector('.search-main').textContent);
              searchInput.value = item.querySelector('.search-main').textContent;
              searchDropdown.style.display = 'none';
            };
          });
        }
      });
  }, 180);
};
searchInput.onblur = function() { setTimeout(()=>searchDropdown.style.display = 'none', 200); };
searchInput.onfocus = function() {
  if(searchDropdown.innerHTML && searchDropdown.innerHTML !== '') {
    searchDropdown.style.display = 'block';
  }
};
searchForm.onsubmit = function(e) {
  e.preventDefault();
  const q = searchInput.value.trim();
  if(!q) return;
  fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`)
    .then(r=>r.json()).then(data=>{
      if(data.length) {
        map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 16, {animate:true});
        showQuickModal('📍 '+(data[0].display_name.split(",")[0]));
      } else showQuickModal("No encontrado.");
    });
  searchDropdown.style.display = 'none';
  return false;
};

// === MAPA Y RECORRIDO ===
function initMap() {
  map = L.map('map', {
    zoomControl: true,
    attributionControl:false,
    center: [-34.6037, -58.3816],
    zoom: 16,
    dragging: true,
    tap: false
  });
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom: 19});
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19});
  const dark = L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {maxZoom: 19});
  const baseMaps = {
    "Satélite": satellite,
    "Negro": dark,
    "Callejero": osm
  };
  satellite.addTo(map);
  L.control.layers(baseMaps, null, {position:'topright'}).addTo(map);
  pathPolyline = L.polyline([], {color:'#50e3a4', weight:6, opacity:0.93}).addTo(map);
  routePolyline = L.polyline([], {color:'#ff8000', weight:6, dashArray:'8,6', opacity:0.8}).addTo(map);
}
document.getElementById('expandMapBtn').onclick = function() {
  let mapExpanded = this.innerText==="🗖";
  document.getElementById('mapWrapper').style.position = mapExpanded ? "fixed" : "relative";
  document.getElementById('mapWrapper').style.top = mapExpanded ? "0" : "";
  document.getElementById('mapWrapper').style.left = mapExpanded ? "0" : "";
  document.getElementById('mapWrapper').style.right = mapExpanded ? "0" : "";
  document.getElementById('mapWrapper').style.width = mapExpanded ? "100vw" : "";
  document.getElementById('mapWrapper').style.height = mapExpanded ? "100vh" : "";
  document.getElementById('mainContent').style.display = mapExpanded ? "none" : "";
  document.getElementById('map').style.height = mapExpanded ? "100vh" : "295px";
  setTimeout(()=>map.invalidateSize(),100);
  this.innerText = mapExpanded ? "🗗" : "🗖";
  document.getElementById('distanceEstimatePanel').style.position = mapExpanded ? "fixed":"";
  document.getElementById('distanceEstimatePanel').style.bottom = mapExpanded ? "18px":"";
  document.getElementById('distanceEstimatePanel').style.left = mapExpanded ? "50%":"";
  document.getElementById('distanceEstimatePanel').style.transform = mapExpanded ? "translateX(-50%)":"";
};
function askLocationPermissionAndTrack() {
  if (!navigator.geolocation) { showModal("Tu navegador no soporta geolocalización."); return; }
  navigator.geolocation.getCurrentPosition(function(pos){
    realCoords = {lat: pos.coords.latitude, lng: pos.coords.longitude};
    map.setView(realCoords, 17, {animate:true});
    updateUserMarker(realCoords, pos.coords.accuracy||20);
    updateWeatherBar(realCoords.lat, realCoords.lng);
    showQuickModal("Ubicación exacta detectada.");
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(function(p){
      realCoords = {lat: p.coords.latitude, lng: p.coords.longitude};
      updateUserMarker(realCoords, p.coords.accuracy||20);
    }, function(e){
      showModal("No se pudo obtener tu ubicación. Verifica permisos y GPS.");
    }, {enableHighAccuracy:true, maximumAge:2000, timeout:15000});
  }, function(err){
    showModal("Para usar FLOKOOB concede permisos de ubicación.");
  }, {enableHighAccuracy:true, maximumAge:2000, timeout:15000});
}
document.getElementById("locateBtn").onclick = askLocationPermissionAndTrack;
function updateUserMarker(coord, accuracy=20) {
  if (userMarker) {
    userMarker.setLatLng(coord);
    if (accuracyCircle) accuracyCircle.setLatLng(coord).setRadius(accuracy);
  } else {
    userMarker = L.marker(coord, {
      icon: L.icon({iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',iconSize: [38,38],iconAnchor: [19,38],className: 'gps-marker'})
    }).addTo(map);
    accuracyCircle = L.circle(coord, {color: "#50e3a499",fillColor: "#50e3a455",fillOpacity: 0.4,radius: accuracy}).addTo(map);
  }
}

// === BORRAR RECORRIDO / PUNTOS ===
function clearAllRoutes() {
  pathPolyline.setLatLngs([]);
  routePolyline.setLatLngs([]);
  manualRoutePoints = [];
  state.route = [];
  state.autoRoute = [];
  routeMarkers.forEach(m=>map.removeLayer(m));
  routeMarkers = [];
  document.getElementById("floatingRouteInfo").style.display = "none";
  document.getElementById("routePointsPanel").innerHTML = "";
  hideLiveRouteProgress();
}
document.getElementById("clearRouteBtn").onclick = function() {
  clearAllRoutes();
  disableRouteDrawMode();
  if (routingControl) map.removeControl(routingControl), routingControl=null;
  showQuickModal("Ruta borrada.");
};

// === RUTA MANUAL ===
function renderRoutePointsPanel() {
  const panel = document.getElementById('routePointsPanel');
  if (!routeMode || manualRoutePoints.length === 0) { panel.innerHTML = ""; panel.style.display = "none"; return; }
  panel.style.display = "flex";
  panel.innerHTML = manualRoutePoints.map((pt, i) =>
    `<div class="route-point-chip">#${i+1}
      <button class="remove-point" title="Quitar punto" onclick="window.removeManualRoutePoint(${i})">✕</button>
    </div>`
  ).join('');
}
window.removeManualRoutePoint = function(idx) {
  manualRoutePoints.splice(idx, 1);
  if(manualRoutePoints.length >= 2) {
    traceManualRoute();
  } else {
    clearAllRoutes();
  }
  renderRoutePointsPanel();
};
function enableRouteDrawMode() {
  routeMode = true;
  document.getElementById('routeDrawBtn').disabled = true;
  document.getElementById('clearRouteBtn').style.display = "inline-block";
  showQuickModal('Toca en el mapa para marcar el recorrido (2 o más puntos).');
  map.on('click', addManualRoutePoint);
  renderRoutePointsPanel();
}
function disableRouteDrawMode() {
  routeMode = false;
  document.getElementById('routeDrawBtn').disabled = false;
  document.getElementById('clearRouteBtn').style.display = "none";
  map.off('click', addManualRoutePoint);
  renderRoutePointsPanel();
}
function addManualRoutePoint(e) {
  manualRoutePoints.push([e.latlng.lat, e.latlng.lng]);
  renderRoutePointsPanel();
  if(manualRoutePoints.length >= 2) traceManualRoute();
}
function traceManualRoute() {
  if(manualRouting) map.removeControl(manualRouting), manualRouting=null;
  manualRouting = L.Routing.control({
    waypoints: manualRoutePoints.map(pt=>L.latLng(pt[0], pt[1])),
    lineOptions: {styles: [{color:'#ff8000',weight:6,opacity:0.85}]},
    addWaypoints: false,
    draggableWaypoints: false,
    fitSelectedRoutes: true,
    show: false,
    router: L.Routing.osrmv1({serviceUrl:'https://router.project-osrm.org/route/v1'})
  }).addTo(map);
  manualRouting.on('routesfound', function(e){
    const route = e.routes[0];
    state.route = route.coordinates.map(c=>({lat:c.lat, lng:c.lng}));
    routePolyline.setLatLngs(state.route);
    document.getElementById("floatingRouteInfo").innerHTML =
      `<span>Distancia: ${(route.summary.totalDistance/1000).toFixed(2)} km<br>
      <span style="font-size:0.98em;">Tiempo estimado: ${(route.summary.totalTime/60).toFixed(0)} min</span></span>`;
    document.getElementById("floatingRouteInfo").style.display = "block";
    showLiveRouteProgress(route.summary.totalDistance/1000, route.summary.totalDistance/1000);
  });
  manualRouting.on('routingerror', function(){ showQuickModal('No se pudo calcular ruta.'); });
}

// === RUTA AUTOMÁTICA ===
function enableRouteAutoMode() {
  autoRouteMode = true;
  document.getElementById('routeAutoBtn').disabled = true;
  document.getElementById('routeInputs').style.display = 'block';
  document.getElementById('clearRouteBtn').style.display = "inline-block";
  showQuickModal('Indica largada y llegada (o usa tu ubicación)');
}
function disableRouteAutoMode() {
  autoRouteMode = false;
  document.getElementById('routeAutoBtn').disabled = false;
  document.getElementById('routeInputs').style.display = 'none';
  document.getElementById('clearRouteBtn').style.display = "none";
}
function geocode(address, cb) {
  fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`)
    .then(r=>r.json()).then(data=>{
      if(data && data.length>0) {
        cb({lat:parseFloat(data[0].lat),lng:parseFloat(data[0].lon)});
      } else { cb(null); }
    }).catch(()=>cb(null));
}
document.getElementById('findRouteBtn').onclick = function() {
  const startAdr = document.getElementById('startPoint').value;
  const endAdr = document.getElementById('endPoint').value;
  if(!startAdr||!endAdr) {
    showQuickModal("Completa ambos puntos.");
    return;
  }
  geocode(startAdr, ptA=>{
    if(!ptA) return showQuickModal("No se encontró largada.");
    geocode(endAdr, ptB=>{
      if(!ptB) return showQuickModal("No se encontró llegada.");
      getRouteWithRoutingMachine(ptA, ptB);
    });
  });
};
document.getElementById('useCurrentLocationBtn').onclick = function() {
  if(!realCoords) {
    askLocationPermissionAndTrack();
    showQuickModal("Ubicación no detectada aún.");
    return;
  }
  document.getElementById('startPoint').value = `${realCoords.lat},${realCoords.lng}`;
  showQuickModal("Usando tu ubicación como largada.");
};
function getRouteWithRoutingMachine(startPt, endPt) {
  if(routingControl) map.removeControl(routingControl);
  routingControl = L.Routing.control({
    waypoints: [L.latLng(startPt.lat, startPt.lng), L.latLng(endPt.lat, endPt.lng)],
    lineOptions: {styles: [{color:'#ff8000',weight:6,opacity:0.85}]},
    addWaypoints: false,
    draggableWaypoints: false,
    fitSelectedRoutes: true,
    show: false,
    router: L.Routing.osrmv1({serviceUrl:'https://router.project-osrm.org/route/v1'})
  }).addTo(map);
  routingControl.on('routesfound', function(e){
    const route = e.routes[0];
    state.autoRoute = route.coordinates.map(c=>({lat:c.lat, lng:c.lng}));
    state.routeTotalKm = route.summary.totalDistance/1000;
    state.routeRemainingKm = state.routeTotalKm;
    drawAutoRoute();
    disableRouteAutoMode();
    showLiveRouteProgress(route.summary.totalDistance/1000, route.summary.totalDistance/1000);
  });
  routingControl.on('routingerror', function(){ showQuickModal('No se pudo calcular la ruta.'); disableRouteAutoMode(); });
}
function drawAutoRoute() {
  routePolyline.setLatLngs(state.autoRoute);
  routeMarkers.forEach(m=>map.removeLayer(m));
  routeMarkers = [];
  if(state.autoRoute.length>0) {
    const markerStart = L.marker(state.autoRoute[0], {icon: L.divIcon({className:'route-marker',html:`<div style="background:#ffd600;color:#111;font-weight:bold;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:2px solid #fff800;">🏁</div>`,iconSize:[32,32],iconAnchor:[16,16]})}).addTo(map);
    const markerEnd = L.marker(state.autoRoute[state.autoRoute.length-1], {icon: L.divIcon({className:'route-marker',html:`<div style="background:#ff8000;color:#fff;font-weight:bold;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:2px solid #fff800;">🏅</div>`,iconSize:[32,32],iconAnchor:[16,16]})}).addTo(map);
    routeMarkers.push(markerStart, markerEnd);
  }
}

// === PROGRESO EN RUTA ===
function showLiveRouteProgress(totalKm, remainKm) {
  state.routeTotalKm = totalKm;
  state.routeRemainingKm = remainKm;
  document.getElementById("distanceEstimatePanel").style.display = "block";
  document.getElementById("distanceRemaining").innerText = remainKm.toFixed(2);
  let speed = state.speeds.length>0 ? state.speeds[state.speeds.length-1] : 9.5;
  if(speed<1) speed=9.5;
  let timeMin = (remainKm/(speed/3.6))/60;
  document.getElementById("timeRemaining").innerText = (isFinite(timeMin)?Math.round(timeMin):"--") + " min";
}
function hideLiveRouteProgress() {
  document.getElementById("distanceEstimatePanel").style.display = "none";
}
function updateLiveRouteProgress(currentPos) {
  let arr = state.autoRoute.length ? state.autoRoute : state.route.length ? state.route : null;
  if(!arr) return;
  let minDist = Infinity, totalDist = 0, nearestIdx = 0;
  for(let i=0;i<arr.length;i++) {
    let d = calcDistance(currentPos, arr[i]);
    if(d < minDist) { minDist = d; nearestIdx = i; }
  }
  for(let i=nearestIdx;i<arr.length-1;i++)
    totalDist += calcDistance(arr[i], arr[i+1]);
  let remainKm = totalDist/1000;
  showLiveRouteProgress(state.routeTotalKm || remainKm, remainKm);
}

// === GPS Y RECORRIDO ===
function onLocation(pos) {
  const lat = pos.coords.latitude, lng = pos.coords.longitude;
  const accuracy = pos.coords.accuracy || 20;
  const coord = {lat, lng};
  let elev = null;
  if (pos.coords.altitude !== null) elev = pos.coords.altitude;
  const now = Date.now();
  let addPoint = true;
  if (state.positions.length > 0) {
    const lastPos = state.positions[state.positions.length-1];
    const lastTime = state.times[state.times.length-1];
    const dist = calcDistance(lastPos, coord);
    const timeDelta = (Math.round((now-state.startTime)/1000)) - lastTime;
    const vel = dist / (timeDelta > 0 ? timeDelta : 1);
    if (dist < 3 || vel > 7) addPoint = false;
  }
  if (addPoint) {
    let delta = 0, tdelta = 1, spd = 0;
    if (state.positions.length > 0) {
      delta = calcDistance(state.positions[state.positions.length-1], coord);
      state.distances.push(state.distances[state.distances.length-1] + delta);
      state.times.push(Math.round((now - state.startTime)/1000));
      const prevElev = state.elevations[state.elevations.length-1];
      if (elev !== null && prevElev !== null) {
        if (elev > prevElev) state.elevGain += elev-prevElev;
        else state.elevLoss += prevElev-elev;
      }
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
    updateUserMarker(coord, accuracy);
    pathPolyline.setLatLngs(state.positions);
    if (state.positions.length===1 || state.positions.length%5===0)
      map.setView(coord, 16);
    updateStats();
    updateCharts();
    if(state.autoRoute.length || state.route.length) updateLiveRouteProgress(coord);
    const distKm = state.distances[state.distances.length-1]/1000;
    if (voiceOn && distKm >= kmVoiceNext) {
      speak(`Has recorrido ${kmVoiceNext} kilómetro${kmVoiceNext>1?'s':''}. Tiempo: ${formatTime(state.elapsed)}. Ritmo: ${calcPace(distKm,state.elapsed)} por kilómetro. ¡Sigue así!`);
      kmVoiceNext++;
      state.lastVoiceKm = kmVoiceNext-1;
    }
  }
}
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(()=>{
    if (!paused) {
      state.elapsed = Math.round((Date.now() - state.startTime)/1000);
      updateStats();
    }
  }, 1000);
}

// === BOTONES PRINCIPALES ===
document.getElementById('startBtn').onclick = function() {
  if (started) return;
  started = true; paused = false; state.startTime = Date.now(); state.elapsed = 0;
  state.positions = []; state.distances = []; state.times = []; state.elevations = []; state.speeds = [];
  state.laps = []; state.elevGain = 0; state.elevLoss = 0; kmVoiceNext = 1; state.lastElev = 0; state.lastVoiceKm = 0;
  pathPolyline.setLatLngs([]); if (userMarker) map.removeLayer(userMarker), userMarker = null; if (accuracyCircle) map.removeLayer(accuracyCircle), accuracyCircle = null;
  updateStats(); updateLaps(); updateCharts(); updateNextTurn("", false);
  this.disabled = true; document.getElementById('pauseBtn').disabled = false; document.getElementById('lapBtn').disabled = false; document.getElementById('resetBtn').disabled = false;
  if (navigator.geolocation) { watchId = navigator.geolocation.watchPosition(onLocation, handleError, {enableHighAccuracy: true, maximumAge: 1000, timeout:10000}); }
  else { showQuickModal("Tu navegador no soporta geolocalización."); }
  startTimer();
  if(voiceOn) speak('Comenzando entrenamiento. ¡Vamos!');
};
document.getElementById('pauseBtn').onclick = function() {
  if (!started) return;
  paused = !paused;
  if (paused) {
    this.textContent = '⏵ Seguir';
    if (watchId!==null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if(voiceOn) speak('Pausa. Puedes descansar.');
    updateNextTurn("", false);
  } else {
    this.textContent = '⏸ Pausa';
    if (navigator.geolocation) { watchId = navigator.geolocation.watchPosition(onLocation, handleError, {enableHighAccuracy: true, maximumAge: 1000, timeout:10000}); }
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
  started = false; paused = false; if (timerInterval) clearInterval(timerInterval), timerInterval=null;
  if (watchId!==null) navigator.geolocation.clearWatch(watchId), watchId=null;
  state.positions = []; state.distances = []; state.times = []; state.elevations = []; state.laps = []; state.speeds = [];
  state.elapsed = 0; state.elevGain = 0; state.elevLoss = 0; kmVoiceNext = 1; state.lastElev = 0; state.lastVoiceKm = 0;
  pathPolyline.setLatLngs([]); if (userMarker) map.removeLayer(userMarker), userMarker = null; if (accuracyCircle) map.removeLayer(accuracyCircle), accuracyCircle = null;
  updateStats(); updateLaps(); updateCharts(); updateNextTurn("", false);
  document.getElementById('startBtn').disabled = false; document.getElementById('pauseBtn').disabled = true; document.getElementById('lapBtn').disabled = true; document.getElementById('resetBtn').disabled = true; document.getElementById('pauseBtn').textContent = '⏸ Pausa';
  if(voiceOn) speak('Entrenamiento reseteado. Listo para un nuevo desafío.');
};
document.getElementById('voiceBtn').onclick = function() {
  voiceOn = !voiceOn;
  this.textContent = voiceOn ? '🔊 Voz' : '🔇 Voz';
  if (voiceOn) speak('Voz activada');
  else window.speechSynthesis.cancel();
};
document.getElementById('routeDrawBtn').onclick = function() { enableRouteDrawMode(); };
document.getElementById('routeAutoBtn').onclick = function() { enableRouteAutoMode(); };

// === COMPARTIR Y EXPORTAR ===
document.getElementById('shareBtn').onclick = function() {
  const lastDist = state.distances.length>0 ? state.distances[state.distances.length-1] : 0;
  const lastTime = state.times.length>0 ? state.times[state.times.length-1] : 0;
  const msg = `🚀 FLOKOOB\n${formatTime(lastTime)}\n${(lastDist/1000).toFixed(2)} km\nRitmo: ${calcPace(lastDist/1000,lastTime)}\n¡Mirá mi recorrido!`;
  if(navigator.share) {
    navigator.share({text:msg,url:location.href});
  } else {
    showModal(msg);
  }
};
document.getElementById('exportBtn').onclick = function() {
  let gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="FLOKOOB"><trk><name>Actividad FLOKOOB</name><trkseg>`;
  state.positions.forEach((pt,i)=>{
    gpx+=`<trkpt lat="${pt.lat}" lon="${pt.lng}"><ele>${state.elevations[i]||0}</ele><time>${new Date(state.startTime+i*1000).toISOString()}</time></trkpt>`;
  });
  gpx+=`</trkseg></trk></gpx>`;
  const blob = new Blob([gpx],{type:"application/gpx+xml"});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'actividad_flokoob.gpx';
  a.click();
};

// === DESCARGAR RESUMEN PNG TRANSPARENTE ===
document.getElementById('summaryBtn').onclick = function() {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 340;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  ctx.save();
  ctx.shadowColor = "#0006"; ctx.shadowBlur = 14;
  ctx.fillStyle = "rgba(23,27,34,0.0)";
  ctx.fillRect(0,0,c.width,c.height);
  ctx.restore();
  ctx.font = "bold 32px Montserrat,Arial";
  ctx.fillStyle = "#50e3a4";
  ctx.fillText("FLOKOOB RUN", 28, 44);
  ctx.save();
  ctx.translate(28,100);
  ctx.strokeStyle="#50e3a4";
  ctx.lineWidth=6;
  if(state.positions.length>1){
    let xs = state.positions.map(pt=>pt.lng), ys = state.positions.map(pt=>pt.lat);
    let minx=Math.min(...xs), maxx=Math.max(...xs), miny=Math.min(...ys), maxy=Math.max(...ys);
    let dx=maxx-minx, dy=maxy-miny;
    let scale = Math.min(540/(dx||1),180/(dy||1)) * 0.88;
    ctx.beginPath();
    state.positions.forEach((pt,i)=>{
      let x = ((pt.lng-minx)*scale)+8;
      let y = ((maxy-pt.lat)*scale)+8;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    let x0=((state.positions[0].lng-minx)*scale)+8, y0=((maxy-state.positions[0].lat)*scale)+8;
    let x1=((state.positions[state.positions.length-1].lng-minx)*scale)+8, y1=((maxy-state.positions[state.positions.length-1].lat)*scale)+8;
    ctx.fillStyle="#ffd600"; ctx.beginPath(); ctx.arc(x0,y0,8,0,2*Math.PI); ctx.fill();
    ctx.fillStyle="#ff8000"; ctx.beginPath(); ctx.arc(x1,y1,8,0,2*Math.PI); ctx.fill();
  }
  ctx.restore();
  ctx.font = "700 22px Montserrat,Arial";
  ctx.fillStyle = "#f8f8fa";
  ctx.fillText("Recorrido: "+(state.distances.length>0? (state.distances[state.distances.length-1]/1000).toFixed(2)+" km" : "0.00 km"), 28, 238);
  ctx.fillText("Tiempo: "+formatTime(state.elapsed), 28, 266);
  ctx.fillText("Vel. Prom: "+(state.speeds.length>0? (state.speeds.reduce((a,b)=>a+b,0)/state.speeds.length).toFixed(1) : "0.0")+" km/h", 28, 294);
  ctx.fillText("Ritmo Prom: "+(state.distances.length>0? calcPace(state.distances[state.distances.length-1]/1000,state.elapsed) : "--:--")+" min/km", 28, 322);
  ctx.fillStyle = "#b4f9d2";
  ctx.font = "bold 17px Montserrat,Arial";
  ctx.fillText("Elevación: "+Math.round(state.elevGain)+"↑ "+Math.round(state.elevLoss)+"↓ m", 340, 238);
  ctx.font = "italic 19px Montserrat,Arial";
  ctx.fillStyle = "#c2c7cb";
  ctx.fillText("© FLOKOOB "+(new Date().getFullYear()), 340, 322);
  c.toBlob(function(blob){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = "flokoob_resumen.png";
    a.click();
  }, "image/png");
};

// === UTILIDADES RECORRIDO Y STATS ===
function formatTime(sec) {
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  return (h>0?String(h).padStart(2,'0')+':':'') + String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function calcDistance(pos1, pos2) {
  const toRad = x => x * Math.PI / 180;
  const R = 6371e3;
  const dLat = toRad(pos2.lat - pos1.lat);
  const dLon = toRad(pos2.lng - pos1.lng);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(pos1.lat)) * Math.cos(toRad(pos2.lat)) * Math.sin(dLon/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
function calcPace(distKm, sec) {
  if (distKm <= 0.01 || sec < 10) return "--:--";
  const pace = sec / distKm;
  const min = Math.floor(pace/60);
  const secd = Math.round(pace%60);
  return `${min}:${String(secd).padStart(2,'0')}`;
}
function getSpeed(last, now, tdelta) {
  if (!last || !now || tdelta === 0) return 0;
  const d = calcDistance(last, now);
  return (d/tdelta)*3.6;
}
function speak(text) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const msg = new SpeechSynthesisUtterance(text);
  msg.lang = "es-ES";
  msg.rate = 1;
  window.speechSynthesis.speak(msg);
}
function updateStats() {
  const dist = state.distances.length > 0 ? state.distances[state.distances.length-1] : 0;
  const distKm = dist / 1000;
  const speed = state.speeds.length > 0 ? state.speeds[state.speeds.length-1] : 0;
  document.getElementById('distance').textContent = distKm.toFixed(2);
  document.getElementById('time').textContent = formatTime(state.elapsed);
  document.getElementById('pace').textContent = (distKm>0.01 ? calcPace(distKm, state.elapsed) : "--:--");
  document.getElementById('speed').textContent = speed.toFixed(1);
  document.getElementById('elev').textContent = `${Math.round(state.elevGain)}↑ ${Math.round(state.elevLoss)}↓`;
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
function updateCharts() {}
function updateNextTurn(text, show) {
  const section = document.getElementById('nextTurn');
  const turnText = document.getElementById('turnText');
  if (show) { section.style.display = 'block'; turnText.textContent = text; }
  else { section.style.display = 'none'; }
}

// === HISTORIAL Y LOGROS (igual que antes) ===
// ... puedes pegar los bloques de historial y logros aquí (idénticos a la versión anterior) ...

window.onload = function() {
  initMap();
  askLocationPermissionAndTrack();
  updateStats();
  updateLaps();
  updateCharts();
  document.getElementById('sosContact').value = localStorage.getItem('flokoob_sos')||"";
  document.getElementById('startBtn').disabled = false;
  document.getElementById('pauseBtn').disabled = true;
  document.getElementById('lapBtn').disabled = true;
  document.getElementById('resetBtn').disabled = true;
  showSection('runSection');
  setActiveNav('navRun');
};

function handleError(e) { showQuickModal("Error de GPS: "+e.message); }

document.getElementById('navRun').onclick = ()=>{ showSection('runSection'); setActiveNav('navRun'); };
document.getElementById('navHistory').onclick = ()=>{ showSection('historySection'); setActiveNav('navHistory'); loadHistory(); };
document.getElementById('navAchievements').onclick = ()=>{ showSection('achievementsSection'); setActiveNav('navAchievements'); showAchievements(); };
document.getElementById('navSettings').onclick = ()=>{ showSection('settingsSection'); setActiveNav('navSettings'); };
document.getElementById('darkModeToggle').onchange = function() { document.body.style.background = this.checked ? "#101114":""; };
document.getElementById('liveShareToggle').onchange = function() { showQuickModal("Función próximamente."); };
document.getElementById('hrmToggle').onchange = function() { showQuickModal("Sensor de pulso próximamente."); };
document.getElementById('sosContact').onblur = function() { localStorage.setItem('flokoob_sos', this.value); };

// === HISTORIAL ===
function saveActivityToHistory() {
  if (state.positions.length < 5) return;
  let history = JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");
  history.unshift({
    date: new Date().toISOString(),
    dist: state.distances[state.distances.length-1]/1000,
    time: state.times[state.times.length-1],
    elev: state.elevGain,
    route: state.positions,
    laps: state.laps
  });
  history = history.slice(0, 30);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}
function loadHistory() {
  const history = JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");
  const ul = document.getElementById('historyList');
  ul.innerHTML = '';
  if (history.length === 0) {
    ul.innerHTML = '<li style="color:#888">No hay actividades registradas aún.</li>';
    return;
  }
  history.forEach((item,i) => {
    ul.innerHTML += `<li>
      <b>${(item.dist||0).toFixed(2)} km</b> - <span>${formatTime(item.time)}</span>
      <br><small>${(new Date(item.date)).toLocaleDateString()}<br>Elev: ${Math.round(item.elev)} m</small>
      <button onclick="window.loadHistoryActivity(${i})" class="btn btn-secondary" style="font-size:0.9em;margin-top:4px;">Ver</button>
      </li>`;
  });
}
window.loadHistoryActivity = function(idx) {
  const history = JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");
  const item = history[idx];
  if (!item) return;
  showSection('runSection');
  setActiveNav('navRun');
  pathPolyline.setLatLngs(item.route);
  map.fitBounds(item.route);
  showQuickModal("Recorrido de actividad cargado.");
};

// === LOGROS ===
function calcAchievements() {
  const history = JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");
  let totalKm = 0, days = {}, maxKm = 0, maxDistDay = "";
  history.forEach(act=>{
    totalKm += act.dist||0;
    const day = (new Date(act.date)).toLocaleDateString();
    days[day] = (days[day]||0)+(act.dist||0);
    if (days[day]>maxKm) {maxKm = days[day]; maxDistDay = day;}
  });
  return {
    totalKm: totalKm,
    totalRuns: history.length,
    maxKm: maxKm,
    maxDistDay: maxDistDay
  };
}
function showAchievements() {
  const ach = calcAchievements();
  document.getElementById('achievementsContent').innerHTML = `
    <div><b>Total Km:</b> <span style="color:#50e3a4;">${ach.totalKm.toFixed(2)} km</span></div>
    <div><b>Carreras guardadas:</b> ${ach.totalRuns}</div>
    <div><b>Kms en un día:</b> ${ach.maxKm.toFixed(2)} (${ach.maxDistDay})</div>
    <hr>
    <div>¡Sigue sumando logros y kilómetros!</div>
  `;
}
