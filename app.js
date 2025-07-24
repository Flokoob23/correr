// FLOKOOB - App profesional con historial, logros, compartir, guiado y más
// ¡Incluye todos los módulos recomendados!

// ========== ESTADO GLOBAL ==========
let map, userMarker, accuracyCircle, pathPolyline;
let chartPace, chartElev, chartSpeed;
let routePolyline, routeMarkers = [];
let routingControl = null;
let routeMode = false, autoRouteMode = false, guideMode = false;
let watchId = null, started = false, paused = false, timerInterval = null, voiceOn = true;
let kmVoiceNext = 1;
let nextTurnIndex = 0;
let guidePlan = null, guideStep = 0, guideActive = false;
const STORAGE_KEY = "flokoob_activities_v1";
const LOGRO_KEY = "flokoob_achievements_v1";
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
  hrm: [],
  shareLive: false,
  emergencyContact: "",
  darkMode: true
};

// ========== UTILIDADES ==========
function formatTime(sec) { /* igual que antes */ const h = Math.floor(sec/3600); const m = Math.floor((sec%3600)/60); const s = sec%60; return (h>0?String(h).padStart(2,'0')+':':'') + String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'); }
function calcDistance(pos1, pos2) { /* igual que antes */ const toRad = x => x * Math.PI / 180; const R = 6371e3; const dLat = toRad(pos2.lat - pos1.lat); const dLon = toRad(pos2.lng - pos1.lng); const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(pos1.lat)) * Math.cos(toRad(pos2.lat)) * Math.sin(dLon/2) ** 2; const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); return R * c; }
function calcPace(distKm, sec) { /* igual que antes */ if (distKm === 0) return '0:00'; const pace = sec / distKm; const min = Math.floor(pace/60); const secd = Math.round(pace%60); return `${min}:${String(secd).padStart(2,'0')}`; }
function getSpeed(last, now, tdelta) { if (!last || !now || tdelta === 0) return 0; const d = calcDistance(last, now); return (d/tdelta)*3.6; }
async function getElevation(lat, lng) { try { const url = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`; const res = await fetch(url); const data = await res.json(); return data.results[0].elevation; } catch { return null; } }
function speak(text) { if (!voiceOn || !('speechSynthesis' in window)) return; window.speechSynthesis.cancel(); const msg = new SpeechSynthesisUtterance(text); msg.lang = "es-ES"; msg.rate = 1; window.speechSynthesis.speak(msg); }
function saveActivityToStorage(act) { let arr = JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]"); arr.unshift(act); localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }
function getActivitiesFromStorage() { return JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]"); }
function saveAchievementsToStorage(logros) { localStorage.setItem(LOGRO_KEY, JSON.stringify(logros)); }
function getAchievementsFromStorage() { return JSON.parse(localStorage.getItem(LOGRO_KEY)||"{}"); }
function getTotalKm() { const acts = getActivitiesFromStorage(); return acts.reduce((acc,a)=>acc+a.distance,0); }
function getBestPace() { const acts = getActivitiesFromStorage(); return acts.length ? Math.min(...acts.map(a=>a.avgPace)) : 0; }
function getBestDistance() { const acts = getActivitiesFromStorage(); return acts.length ? Math.max(...acts.map(a=>a.distance)) : 0; }
function getBestTime() { const acts = getActivitiesFromStorage(); return acts.length ? Math.max(...acts.map(a=>a.elapsed)) : 0; }
function updateAchievements() {
  let logros = getAchievementsFromStorage();
  let totalKm = getTotalKm();
  let bestPace = getBestPace();
  let bestDist = getBestDistance();
  let bestTime = getBestTime();
  logros = {
    km: totalKm,
    bestPace,
    bestDist,
    bestTime,
    medals: [
      totalKm >= 42.195 ? "Maratón" : "",
      bestDist >= 21.097 ? "Media maratón" : "",
      bestDist >= 10 ? "10K" : "",
      bestDist >= 5 ? "5K" : "",
      bestPace && bestPace<5 ? "Rápido" : ""
    ].filter(x=>x)
  };
  saveAchievementsToStorage(logros);
}

// ========== UI ==========
function updateStats() { /* igual que antes */ const dist = state.distances.length > 0 ? state.distances[state.distances.length-1] : 0; const distKm = dist / 1000; const speed = state.speeds.length > 0 ? state.speeds[state.speeds.length-1] : 0; document.getElementById('distance').textContent = distKm.toFixed(2); document.getElementById('time').textContent = formatTime(state.elapsed); document.getElementById('pace').textContent = (distKm>0 ? calcPace(distKm, state.elapsed) : '0:00'); document.getElementById('speed').textContent = speed.toFixed(1); document.getElementById('elev').textContent = `${Math.round(state.elevGain)}↑ ${Math.round(state.elevLoss)}↓`; document.getElementById('current-elev').textContent = state.lastElev ? Math.round(state.lastElev) : '0'; }
function updateLaps() { const ul = document.getElementById('lapsList'); ul.innerHTML = ''; if (state.laps.length === 0) { ul.innerHTML = '<li style="color:#888">Ningún parcial aún.</li>'; } else { state.laps.forEach((lap,i) => { ul.innerHTML += `<li>Parcial ${i+1}: ${formatTime(lap.time)} - ${lap.dist.toFixed(2)} km</li>`; }); } }
function updateCharts() { if (!chartPace || !chartElev || !chartSpeed) return; const labels = state.times.map(t=>formatTime(t)); const paces = state.distances.map((d,i)=>{ const distKm = d/1000; return distKm>0 ? state.times[i]/distKm : 0; }); const elevs = state.elevations.map(e=>e?e:0); const speeds = state.speeds.map(v=>v); chartPace.data.labels = labels; chartPace.data.datasets[0].data = paces; chartPace.update('none'); chartElev.data.labels = labels; chartElev.data.datasets[0].data = elevs; chartElev.update('none'); chartSpeed.data.labels = labels; chartSpeed.data.datasets[0].data = speeds; chartSpeed.update('none'); }
function updateNextTurn(text, show) { const section = document.getElementById('nextTurn'); const turnText = document.getElementById('turnText'); if (show) { section.style.display = 'block'; turnText.textContent = text; } else { section.style.display = 'none'; } }
function showSection(secId) { ["runSection","historySection","achievementsSection","settingsSection"].forEach(id=>{document.getElementById(id).style.display = id===secId?"block":"none";}); }
function setActiveNav(navId) { Array.from(document.querySelectorAll('.nav-btn')).forEach(btn=>btn.classList.remove('active')); document.getElementById(navId).classList.add('active'); }

// ========== MAPA ==========
function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl:false,
    center: [-34.6037, -58.3816], // Buenos Aires
    zoom: 14
  });
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

// ========== RUTAS DIBUJADAS ==========
function enableRouteDrawMode() { routeMode = true; document.getElementById('routeDrawBtn').disabled = true; speak('Modo dibujo activado. Haz clic en el mapa para marcar tu recorrido.'); map.on('click', addRoutePoint); }
function disableRouteDrawMode() { routeMode = false; document.getElementById('routeDrawBtn').disabled = false; map.off('click', addRoutePoint); }
function addRoutePoint(e) { const latlng = e.latlng; state.route.push({lat: latlng.lat, lng: latlng.lng}); drawRoute(); }
function drawRoute() { routePolyline.setLatLngs(state.route); routeMarkers.forEach(m=>map.removeLayer(m)); routeMarkers = []; state.route.forEach((pt, i) => { const marker = L.marker(pt, {icon: L.divIcon({className: 'route-marker',html: `<div style="background:#ff8000;color:#fff;font-weight:bold;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:2px solid #fff800;">${i+1}</div>`,iconSize: [28,28],iconAnchor: [14,14]})}); marker.addTo(map); routeMarkers.push(marker); }); }

// ========== RUTAS AUTOMÁTICAS ==========
function enableRouteAutoMode() { autoRouteMode = true; document.getElementById('routeAutoBtn').disabled = true; document.getElementById('routeInputs').style.display = 'block'; speak('Ingresa la largada y la llegada para buscar una ruta.'); }
function disableRouteAutoMode() { autoRouteMode = false; document.getElementById('routeAutoBtn').disabled = false; document.getElementById('routeInputs').style.display = 'none'; }
function geocode(address, cb) { fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`).then(r=>r.json()).then(data=>{ if(data && data.length>0) { cb({lat:parseFloat(data[0].lat),lng:parseFloat(data[0].lon)}); } else { cb(null); } }).catch(()=>cb(null)); }
function findAutoRoute() { const startAdr = document.getElementById('startPoint').value; const endAdr = document.getElementById('endPoint').value; if(!startAdr||!endAdr) { alert("Completa ambos puntos."); return; } geocode(startAdr, startPt=>{ if(!startPt) return alert("No se encontró largada."); geocode(endAdr, endPt=>{ if(!endPt) return alert("No se encontró llegada."); getRouteWithRoutingMachine(startPt, endPt); }); }); }
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
    speak('Ruta encontrada y marcada en el mapa. Ya puedes iniciar tu entrenamiento.');
  });
  routingControl.on('routingerror', function(){ alert('No se pudo calcular la ruta.'); disableRouteAutoMode(); });
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

// ========== ENTRENAMIENTO GUIADO ==========
function enableGuideMode() { guideMode = true; document.getElementById('guidedInputs').style.display = 'block'; speak('Define tu entrenamiento guiado.'); }
function disableGuideMode() { guideMode = false; document.getElementById('guidedInputs').style.display = 'none'; }
function startGuide() {
  const type = document.getElementById('guideType').value;
  const details = document.getElementById('guideDetails').value;
  // Ejemplo simple: intervalos 5x400m rápido, 2min suave
  // En la práctica, deberías parsear y crear un plan de steps. Aquí demo:
  if(type==="interval" && details) {
    guidePlan = [
      {desc:"Calentamiento", dur:300, pace:"suave"},
      {desc:"400m rápido", dist:0.4, pace:"rápido"},
      {desc:"Recuperación 2min", dur:120, pace:"suave"},
      {desc:"400m rápido", dist:0.4, pace:"rápido"},
      {desc:"Recuperación 2min", dur:120, pace:"suave"}
      // ... repite según details
    ];
    guideStep = 0;
    guideActive = true;
    speak('Entrenamiento guiado iniciado. Primer paso: '+guidePlan[0].desc);
  } else {
    speak('Función guiada personalizada no implementada aún.');
  }
  disableGuideMode();
}
function checkGuideStep() {
  // Demo: avisa cuando se cumple la distancia/tiempo programada de cada step
  if(!guideActive || !guidePlan || guideStep>=guidePlan.length) return;
  const step = guidePlan[guideStep];
  if(step.dist && state.distances[state.distances.length-1]/1000 >= step.dist) {
    guideStep++;
    if(guideStep<guidePlan.length) speak('Siguiente: '+guidePlan[guideStep].desc);
    else speak('Entrenamiento guiado finalizado.');
  }
  if(step.dur && state.elapsed >= step.dur) {
    guideStep++;
    if(guideStep<guidePlan.length) speak('Siguiente: '+guidePlan[guideStep].desc);
    else speak('Entrenamiento guiado finalizado.');
  }
}

// ========== TURN DETECTION ==========
function getTurnInstruction(from, to) { if (!from || !to) return ""; const dx = to.lng - from.lng; const dy = to.lat - from.lat; const angle = Math.atan2(dy, dx) * 180 / Math.PI; if (angle > 30) return "Dobla a la izquierda"; if (angle < -30) return "Dobla a la derecha"; return "Sigue recto"; }
function checkUpcomingTurn(currentPos) {
  let routeArr = state.autoRoute.length>0 ? state.autoRoute : state.route;
  if (!routeArr || routeArr.length < 2 || nextTurnIndex >= routeArr.length-1) { updateNextTurn("", false); return; }
  const nextPt = routeArr[nextTurnIndex+1];
  const distToTurn = calcDistance(currentPos, nextPt);
  if (distToTurn < 60 && distToTurn > 30) {
    const from = routeArr[nextTurnIndex];
    const to = routeArr[nextTurnIndex+1];
    const instruction = getTurnInstruction(from, to);
    updateNextTurn(`${instruction} en ${Math.round(distToTurn)} metros`,true);
    if(voiceOn) speak(`${instruction} en ${Math.round(distToTurn)} metros`);
  } else if (distToTurn <= 30) {
    nextTurnIndex++;
    updateNextTurn("", false);
  } else {
    updateNextTurn("", false);
  }
}

// ========== GPS ==========
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
    checkGuideStep();

    const distKm = state.distances[state.distances.length-1]/1000;
    if (voiceOn && distKm >= kmVoiceNext) {
      speak(`Has recorrido ${kmVoiceNext} kilómetro${kmVoiceNext>1?'s':''}. Tiempo: ${formatTime(state.elapsed)}. Ritmo: ${calcPace(distKm,state.elapsed)} por kilómetro. ¡Sigue así!`);
      kmVoiceNext++;
      state.lastVoiceKm = kmVoiceNext-1;
    }

    // HRM demo
    if(state.hrm && state.hrm.length) {
      // Mostrar frecuencia cardíaca
    }
    // Live share demo
    if(state.shareLive) {
      // Enviar datos a servidor o WebRTC (no implementado aquí)
    }
  }
}

// ========== TIMER ==========
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
  else { alert("Tu navegador no soporta geolocalización."); }
  startTimer();
  if(voiceOn) speak('Comenzando entrenamiento. ¡Vamos!');
};
document.getElementById('pauseBtn').onclick = function() {
  if (!started) return;
  paused = !paused;
  if (paused) {
    this.textContent = 'Seguir';
    if (watchId!==null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if(voiceOn) speak('Pausa. Puedes descansar.');
    updateNextTurn("", false);
  } else {
    this.textContent = 'Pausa';
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
  document.getElementById('startBtn').disabled = false; document.getElementById('pauseBtn').disabled = true; document.getElementById('lapBtn').disabled = true; document.getElementById('resetBtn').disabled = true; document.getElementById('pauseBtn').textContent = 'Pausa';
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
document.getElementById('findRouteBtn').onclick = function() { findAutoRoute(); };
document.getElementById('guideBtn').onclick = function() { enableGuideMode(); };
document.getElementById('startGuideBtn').onclick = function() { startGuide(); };

// ========== COMPARTIR / EXPORTAR ==========
document.getElementById('shareBtn').onclick = function() {
  // Compartir actividad
  const lastDist = state.distances.length>0 ? state.distances[state.distances.length-1] : 0;
  const lastTime = state.times.length>0 ? state.times[state.times.length-1] : 0;
  const msg = `🚀 FLOKOOB\n${formatTime(lastTime)}\n${(lastDist/1000).toFixed(2)} km\nRitmo: ${calcPace(lastDist/1000,lastTime)}\n¡Mirá mi recorrido!`;
  if(navigator.share) {
    navigator.share({text:msg,url:location.href});
  } else {
    alert(msg);
  }
};
document.getElementById('exportBtn').onclick = function() {
  // Exportar GPX
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

// ========== HISTORIAL ==========
function renderHistory() {
  const sec = document.getElementById('historySection');
  const acts = getActivitiesFromStorage();
  sec.innerHTML = `<h3>Historial de actividades</h3>` + (acts.length==0 ? "<div>No hay actividades guardadas.</div>" : "<ul>" + acts.map(a=>`<li>${new Date(a.date).toLocaleString()} - ${formatTime(a.elapsed)} - ${(a.distance).toFixed(2)} km - ${calcPace(a.distance,a.elapsed)} <button onclick="viewActivity(${a.id})">Ver</button></li>`).join("") + "</ul>");
}
function viewActivity(id) {
  const acts = getActivitiesFromStorage();
  const a = acts.find(a=>a.id===id);
  if(!a) return;
  alert(`Actividad\n${formatTime(a.elapsed)} - ${(a.distance).toFixed(2)} km\nRitmo promedio: ${calcPace(a.distance,a.elapsed)}`);
  // Podrías mostrar los datos en el mapa y en los gráficos
}

// ========== LOGROS ==========
function renderAchievements() {
  updateAchievements();
  const sec = document.getElementById('achievementsSection');
  const logros = getAchievementsFromStorage();
  sec.innerHTML = `<h3>Logros y Medallas</h3>
  <div>Total km: <strong>${(logros.km||0).toFixed(2)}</strong></div>
  <div>Mejor ritmo: <strong>${(logros.bestPace||0).toFixed(2)}</strong> min/km</div>
  <div>Mejor distancia: <strong>${(logros.bestDist||0).toFixed(2)} km</strong></div>
  <div>Mejor tiempo: <strong>${formatTime(logros.bestTime||0)}</strong></div>
  <div>Medallas: ${(logros.medals||[]).map(m=>`<span class="medal">${m}</span>`).join(", ")}</div>`;
}

// ========== AJUSTES ==========
function renderSettings() {
  const sec = document.getElementById('settingsSection');
  sec.querySelector('#darkModeToggle').checked = state.darkMode;
  sec.querySelector('#liveShareToggle').checked = state.shareLive;
  sec.querySelector('#hrmToggle').checked = !!state.hrm;
  sec.querySelector('#sosContact').value = state.emergencyContact;
  // Listeners para guardar ajustes
  sec.querySelector('#darkModeToggle').onchange = e => { state.darkMode = e.target.checked; document.body.className = state.darkMode?"dark":"light"; };
  sec.querySelector('#liveShareToggle').onchange = e => { state.shareLive = e.target.checked; };
  sec.querySelector('#hrmToggle').onchange = e => { state.hrm = e.target.checked ? [] : null; };
  sec.querySelector('#sosContact').onchange = e => { state.emergencyContact = e.target.value; };
}

// ========== NAVEGACIÓN ==========
document.getElementById('navRun').onclick = function() {showSection("runSection");setActiveNav("navRun");};
document.getElementById('navHistory').onclick = function() {renderHistory();showSection("historySection");setActiveNav("navHistory");};
document.getElementById('navAchievements').onclick = function() {renderAchievements();showSection("achievementsSection");setActiveNav("navAchievements");};
document.getElementById('navSettings').onclick = function() {renderSettings();showSection("settingsSection");setActiveNav("navSettings");};

// ========== ERROR ==========
function handleError(err) { alert("No se pudo obtener tu ubicación.\nActiva el GPS y otorga permisos.\n\n"+err.message); }

// ========== INIT ==========
window.onload = function() {
  initMap();
  setTimeout(()=>map.invalidateSize(),200);
  chartPace = new Chart(document.getElementById('paceChart').getContext('2d'), {type: 'line',data: {labels: [],datasets: [{label: 'Min/Km',data: [],borderColor: '#ffd600',backgroundColor: 'rgba(255,214,0,0.10)',tension: 0.35,fill: true,pointRadius: 0}]},options: {responsive: true,plugins: {legend: {display:false}},scales: {x: {display:false},y: {beginAtZero: true,color: '#ffd600',grid: {color: '#333'},ticks: { color: "#ffd600"}}}}});
  chartElev = new Chart(document.getElementById('elevChart').getContext('2d'), {type: 'line',data: {labels: [],datasets: [{label: 'Elevación',data: [],borderColor: '#bba500',backgroundColor: 'rgba(255,214,0,0.08)',tension: 0.3,fill: true,pointRadius: 0}]},options: {responsive: true,plugins: {legend: {display:false}},scales: {x: {display:false},y: {beginAtZero: false,color: '#ffd600',grid: {color: '#333'},ticks: { color: "#ffd600"}}}}});
  chartSpeed = new Chart(document.getElementById('speedChart').getContext('2d'), {type: 'line',data: {labels: [],datasets: [{label: 'Velocidad',data: [],borderColor: '#ffd600',backgroundColor: 'rgba(255,214,0,0.09)',tension: 0.32,fill: true,pointRadius: 0}]},options: {responsive: true,plugins: {legend: {display:false}},scales: {x: {display:false},y: {beginAtZero: true,color: '#ffd600',grid: {color: '#333'},ticks: { color: "#ffd600"}}}}});
  updateStats(); updateLaps(); updateCharts();
  showSection("runSection"); setActiveNav("navRun");
};
