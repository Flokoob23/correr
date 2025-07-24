// FLOKOOB - Móvil, profesional, UI mejorada, estadísticas reales y rutas claras

let map, userMarker, accuracyCircle, pathPolyline, chartPace, chartElev;
let routePolyline, routeMarkers = [];
let routingControl = null;
let routeMode = false, autoRouteMode = false;
let watchId = null, started = false, paused = false, timerInterval = null, voiceOn = true;
let kmVoiceNext = 1;
let nextTurnIndex = 0;
let realCoords = null;
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
};

function showModal(text) {
  document.getElementById('modalText').innerHTML = text;
  document.getElementById('modalOverlay').style.display = 'flex';
}
function showQuickModal(text, ms=2000) {
  const qm = document.getElementById('quickModal');
  document.getElementById('quickModalText').innerText = text;
  qm.style.display = 'block';
  setTimeout(()=>{ qm.style.display = 'none'; }, ms);
}

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
function updateCharts() {
  if (!chartPace || !chartElev) return;
  const labels = state.times.map(t=>formatTime(t));
  const paces = state.distances.map((d,i)=>{
    const distKm = d/1000;
    if (distKm<=0.01 || state.times[i]<10) return null;
    return state.times[i]/distKm;
  });
  const elevs = state.elevations.map(e=>e?e:0);
  chartPace.data.labels = labels;
  chartPace.data.datasets[0].data = paces;
  chartPace.update('none');
  chartElev.data.labels = labels;
  chartElev.data.datasets[0].data = elevs;
  chartElev.update('none');
}
function updateNextTurn(text, show) {
  const section = document.getElementById('nextTurn');
  const turnText = document.getElementById('turnText');
  if (show) { section.style.display = 'block'; turnText.textContent = text; }
  else { section.style.display = 'none'; }
}
function showSection(secId) {
  ["runSection","historySection","achievementsSection","settingsSection"].forEach(id=>{
    document.getElementById(id).style.display = id===secId?"block":"none";
  });
}
function setActiveNav(navId) {
  Array.from(document.querySelectorAll('.nav-btn')).forEach(btn=>btn.classList.remove('active'));
  document.getElementById(navId).classList.add('active');
}

// ========== MAPA Y UBICACIÓN ==========
function initMap() {
  map = L.map('map', {
    zoomControl: true,
    attributionControl:false,
    center: [-34.6037, -58.3816],
    zoom: 16,
    dragging: true,
    tap: false
  });
  // Satélite por defecto
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
  pathPolyline = L.polyline([], {color:'#ffd600', weight:7, opacity:0.93}).addTo(map);
  routePolyline = L.polyline([], {color:'#ff8000', weight:6, dashArray:'8,6', opacity:0.8}).addTo(map);
}

function askLocationPermissionAndTrack() {
  if (!navigator.geolocation) {
    showModal("Tu navegador no soporta geolocalización.");
    return;
  }
  navigator.geolocation.getCurrentPosition(function(pos){
    realCoords = {lat: pos.coords.latitude, lng: pos.coords.longitude};
    map.setView(realCoords, 17, {animate:true});
    updateUserMarker(realCoords, pos.coords.accuracy||20);
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
    accuracyCircle = L.circle(coord, {color: "#ffd600aa",fillColor: "#ffd60033",fillOpacity: 0.5,radius: accuracy}).addTo(map);
  }
}

// ========== RUTAS MANUAL/AUTOMÁTICAS ==========
function enableRouteDrawMode() {
  routeMode = true;
  document.getElementById('routeDrawBtn').disabled = true;
  showQuickModal('Haz clic en el mapa para marcar el recorrido.');
  map.on('click', addRoutePoint);
}
function disableRouteDrawMode() {
  routeMode = false;
  document.getElementById('routeDrawBtn').disabled = false;
  map.off('click', addRoutePoint);
}
function addRoutePoint(e) {
  const latlng = e.latlng;
  state.route.push({lat: latlng.lat, lng: latlng.lng});
  drawRoute();
  if (state.route.length > 1) {
    let dist = 0;
    for(let i=1;i<state.route.length;i++)
      dist += calcDistance(state.route[i-1],state.route[i]);
    let last = state.route[state.route.length-1];
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${last.lat}&lon=${last.lng}`)
      .then(r=>r.json())
      .then(data=>{
        document.getElementById("floatingRouteInfo").innerHTML =
          `<span>Distancia: ${(dist/1000).toFixed(2)} km<br><span style="font-size:0.98em;">Última calle: ${data.address.road || data.display_name || "?"}</span></span>`;
        document.getElementById("floatingRouteInfo").style.display = "block";
      });
  }
}
function drawRoute() {
  routePolyline.setLatLngs(state.route);
  routeMarkers.forEach(m=>map.removeLayer(m));
  routeMarkers = [];
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

function enableRouteAutoMode() {
  autoRouteMode = true;
  document.getElementById('routeAutoBtn').disabled = true;
  document.getElementById('routeInputs').style.display = 'block';
  showQuickModal('Indica largada y llegada (o usa tu ubicación)');
}
function disableRouteAutoMode() {
  autoRouteMode = false;
  document.getElementById('routeAutoBtn').disabled = false;
  document.getElementById('routeInputs').style.display = 'none';
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
      document.getElementById("routeAnalysis").style.display = "none";
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
    const coordinates = route.coordinates.map(c=>({lat:c.lat, lng:c.lng}));
    state.autoRoute = coordinates;
    drawAutoRoute();
    disableRouteAutoMode();
    let dist = route.summary.totalDistance/1000;
    let timeMin = route.summary.totalTime/60;
    let calleTexto = route.instructions.map(i=>i.text.replace(/(en )?la carretera|(en )?la carretera/g,'').replace(/Continúe/g,'Seguí')).join("<br>");
    showModal(
      `<b>Distancia:</b> ${dist.toFixed(2)} km<br><b>Tiempo estimado:</b> ${Math.round(timeMin)} min<br><b>Calle/indicaciones:</b><br>${calleTexto}`
    );
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

// ========== TURN DETECTION Y GPS ==========
function getTurnInstruction(from, to) {
  if (!from || !to) return "";
  const dx = to.lng - from.lng; const dy = to.lat - from.lat;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle > 30) return "Dobla a la izquierda";
  if (angle < -30) return "Dobla a la derecha";
  return "Seguí recto";
}
function checkUpcomingTurn(currentPos) {
  let routeArr = state.autoRoute.length>0 ? state.autoRoute : state.route;
  if (!routeArr || routeArr.length < 2 || nextTurnIndex >= routeArr.length-1) { updateNextTurn("", false); return; }
  const nextPt = routeArr[nextTurnIndex+1];
  const distToTurn = calcDistance(currentPos, nextPt);
  if (distToTurn < 60 && distToTurn > 30) {
    const from = routeArr[nextTurnIndex];
    const to = routeArr[nextTurnIndex+1];
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${to.lat}&lon=${to.lng}`)
    .then(r=>r.json())
    .then(data=>{
      const calle = data.address.road || data.display_name || "calle";
      const instruction = getTurnInstruction(from, to);
      updateNextTurn(`${instruction} en ${calle} (${Math.round(distToTurn)} m)`,true);
    });
  } else if (distToTurn <= 30) {
    nextTurnIndex++;
    updateNextTurn("", false);
  } else {
    updateNextTurn("", false);
  }
}
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
    const dist = calcDistance(lastPos, coord);
    const timeDelta = (Math.round((now-state.startTime)/1000)) - lastTime;
    const vel = dist / (timeDelta > 0 ? timeDelta : 1);
    // Filtro: solo si movió más de 3 metros y velocidad < 7 m/s (25 km/h)
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
    checkUpcomingTurn(coord);

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

// ========== BOTONES ==========
document.getElementById('startBtn').onclick = function() {
  if (started) return;
  started = true; paused = false; state.startTime = Date.now(); state.elapsed = 0;
  state.positions = []; state.distances = []; state.times = []; state.elevations = []; state.speeds = [];
  state.laps = []; state.elevGain = 0; state.elevLoss = 0; kmVoiceNext = 1; state.lastElev = 0; state.lastVoiceKm = 0; nextTurnIndex = 0;
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
  state.elapsed = 0; state.elevGain = 0; state.elevLoss = 0; kmVoiceNext = 1; state.lastElev = 0; state.lastVoiceKm = 0; nextTurnIndex = 0;
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

// ========== COMPARTIR / EXPORTAR ==========
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

// ========== NAVEGACIÓN ==========
document.getElementById('navRun').onclick = function() {showSection("runSection");setActiveNav("navRun");};
document.getElementById('navHistory').onclick = function() { showQuickModal("Historial próximamente."); showSection("historySection");setActiveNav("navHistory");};
document.getElementById('navAchievements').onclick = function() { showQuickModal("Logros próximamente."); showSection("achievementsSection");setActiveNav("navAchievements");};
document.getElementById('navSettings').onclick = function() { showQuickModal("Ajustes próximamente."); showSection("settingsSection");setActiveNav("navSettings");};

function handleError(err) { showModal("No se pudo obtener tu ubicación.\nActiva el GPS y otorga permisos.\n\n"+err.message); }

window.onload = function() {
  initMap();
  setTimeout(()=>map.invalidateSize(),200);
  chartPace = new Chart(document.getElementById('paceChart').getContext('2d'), {type: 'line',data: {labels: [],datasets: [{label: 'Min/Km',data: [],borderColor: '#ffd600',backgroundColor: 'rgba(255,214,0,0.10)',tension: 0.35,fill: true,pointRadius: 0}]},options: {responsive: true,plugins: {legend: {display:false}},scales: {x: {display:false},y: {beginAtZero: true,color: '#ffd600',grid: {color: '#333'},ticks: { color: "#ffd600"}}}}});
  chartElev = new Chart(document.getElementById('elevChart').getContext('2d'), {type: 'line',data: {labels: [],datasets: [{label: 'Elevación',data: [],borderColor: '#bba500',backgroundColor: 'rgba(255,214,0,0.08)',tension: 0.3,fill: true,pointRadius: 0}]},options: {responsive: true,plugins: {legend: {display:false}},scales: {x: {display:false},y: {beginAtZero: false,color: '#ffd600',grid: {color: '#333'},ticks: { color: "#ffd600"}}}}});
  updateStats(); updateLaps(); updateCharts();
  showSection("runSection"); setActiveNav("navRun");
  askLocationPermissionAndTrack();
};
