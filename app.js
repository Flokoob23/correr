// FLOKOOB - Running Pro: rutas manuales óptimas, clima, búsqueda, UI top

const OWM_API_KEY = "TU_API_KEY_OPENWEATHERMAP"; // ← Cambia esto por tu API KEY de OpenWeatherMap

let map, userMarker, accuracyCircle, pathPolyline, chartPace, chartElev;
let routePolyline, routeMarkers = [];
let routingControl = null;
let routeMode = false, autoRouteMode = false;
let watchId = null, started = false, paused = false, timerInterval = null, voiceOn = true;
let kmVoiceNext = 1;
let realCoords = null;
let manualRouting = null;
const state = {
  positions: [],
  times: [],
  distances: [],
  elevations: [],
  speeds: [],
  laps: [],
  startTime: null,
  elapsed: 0,
  elevGain: 0,
  elevLoss: 0,
  lastElev: 0,
  lastVoiceKm: 0,
  route: [],
  autoRoute: [],
  routeTotalKm: 0,
  routeRemainingKm: 0
};

// === MODALS ===
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

// === BUSCADOR DE UBICACIONES ===
document.getElementById('searchForm').onsubmit = function(e) {
  e.preventDefault();
  const q = document.getElementById('searchInput').value.trim();
  if(!q) return;
  fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`)
    .then(r=>r.json()).then(data=>{
      if(data.length) {
        map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 16, {animate:true});
        showQuickModal('📍 '+(data[0].display_name.split(",")[0]));
      } else showQuickModal("No encontrado.");
    });
  return false;
};

// === AGRANDAR/REDUCIR MAPA ===
let mapExpanded = false;
document.getElementById('expandMapBtn').onclick = function() {
  mapExpanded = !mapExpanded;
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

// === UTILIDADES ===
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

// === MAPA, UBICACIÓN, Y WEATHER ===
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

// === RUTA MANUAL ÓPTIMA (no recta, siempre el camino más rápido) ===
let manualRoutePoints = [];
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
    routePolyline.setLatLngs([]);
    state.route = [];
    document.getElementById("floatingRouteInfo").style.display = "none";
  }
  renderRoutePointsPanel();
};
document.getElementById("clearRouteBtn").onclick = function() {
  manualRoutePoints = [];
  routePolyline.setLatLngs([]);
  renderRoutePointsPanel();
  state.route = [];
  document.getElementById("floatingRouteInfo").style.display = "none";
  disableRouteDrawMode();
  if (routingControl) map.removeControl(routingControl), routingControl=null;
  state.autoRoute = [];
  hideLiveRouteProgress();
  showQuickModal("Ruta borrada.");
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

// === GPS y recorrido ===
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

// ==== RESTO DEL CÓDIGO (botones, stats, laps, charts, compartir, exportar, navegación, etc) ====

/* ...todo el código de botones, stats, laps, charts y navegación del ejemplo anterior, igual... */

// Por brevedad se omite la repetición, pero el archivo debe incluir TODO el código de entrenamiento, historial, logros, compartir, GPX, voz, etc, que ya venías usando previamente, combinando lo anterior + lo nuevo aquí mostrado.

// Inicia la app
window.onload = function() {
  initMap();
  setTimeout(()=>map.invalidateSize(),200);
  chartPace = new Chart(document.getElementById('paceChart').getContext('2d'), {type: 'line',data: {labels: [],datasets: [{label: 'Min/Km',data: [],borderColor: '#50e3a4',backgroundColor: 'rgba(80,227,164,0.12)',tension: 0.35,fill: true,pointRadius: 0}]},options: {responsive: true,plugins: {legend: {display:false}},scales: {x: {display:false},y: {beginAtZero: true,color: '#50e3a4',grid: {color: '#232323'},ticks: { color: "#50e3a4"}}}}});
  chartElev = new Chart(document.getElementById('elevChart').getContext('2d'), {type: 'line',data: {labels: [],datasets: [{label: 'Elevación',data: [],borderColor: '#f4d800',backgroundColor: 'rgba(244,216,0,0.13)',tension: 0.3,fill: true,pointRadius: 0}]},options: {responsive: true,plugins: {legend: {display:false}},scales: {x: {display:false},y: {beginAtZero: false,color: '#f4d800',grid: {color: '#232323'},ticks: { color: "#f4d800"}}}}});
  updateStats(); updateLaps(); updateCharts();
  showSection("runSection"); setActiveNav("navRun");
  askLocationPermissionAndTrack();
};
