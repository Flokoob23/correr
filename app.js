// Variables
let map, positionMarker, routeLine;
let routePoints = [];
let lastPosition = null;
let distance = 0; // km
let elapsedTime = 0;
let timerInterval = null;
let isTracking = false;
let isPaused = false;
let startTime = null;
let watchId = null;
let kmAnnounced = 0;

const timerDisplay = document.getElementById("timer");
const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const stopBtn = document.getElementById("stop-btn");
const statusText = document.getElementById("status-text");
const gpsStatus = document.getElementById("gps-status");
const distanceDisplay = document.getElementById("distance");
const paceDisplay = document.getElementById("pace");
const caloriesDisplay = document.getElementById("calories");
const elevationDisplay = document.getElementById("elevation");
const avgSpeedDisplay = document.getElementById("avg-speed");
const maxSpeedDisplay = document.getElementById("max-speed");
const avgPaceDisplay = document.getElementById("avg-pace");

const ticketModal = document.getElementById("ticket-modal");
const ticketContent = document.getElementById("ticket-content");
const closeTicketBtn = document.getElementById("close-ticket-btn");

function initMap() {
  map = L.map("map").setView([-34.6037, -58.3816], 15);

  const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri'
  });
  const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: 'Carto'
  });

  const baseMaps = { "Calles": street, "Satélite": sat, "Light": light };
  street.addTo(map);
  L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

  positionMarker = L.circleMarker([-34.6037, -58.3816], {
    radius: 6, color: "#4f46e5", fillColor: "#6366f1", fillOpacity: 0.8
  }).addTo(map);

  routeLine = L.polyline([], { color: "#4f46e5", weight: 5 }).addTo(map);
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function formatPace(pace){
  const m = Math.floor(pace), s = Math.round((pace - m)*60);
  return `${m}:${String(s).padStart(2,'0')}`;
}
function speak(txt){
  if('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(txt));
}

function calculateDistance(lat1, lon1, lat2, lon2){
  const R = 6371, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function updateTimer(){
  elapsedTime = Date.now() - startTime;
  timerDisplay.textContent = formatTime(elapsedTime);
  if(distance>0){
    const pace = (elapsedTime/1000/60)/distance;
    paceDisplay.textContent = formatPace(pace);
    avgPaceDisplay.textContent = formatPace(pace);
    const speed = distance/(elapsedTime/3600000);
    avgSpeedDisplay.textContent = speed.toFixed(1)+" km/h";
    caloriesDisplay.textContent = Math.round(distance*65);
  }
}

function watchPosition(){
  return navigator.geolocation.watchPosition(pos=>{
    gpsStatus.textContent="Conectado";
    const {latitude,longitude,altitude,speed}=pos.coords;
    const latlng=[latitude,longitude];
    routePoints.push(latlng);
    positionMarker.setLatLng(latlng);
    map.panTo(latlng);
    if(routePoints.length>1){
      lastPosition = routePoints[routePoints.length-2];
      const seg = calculateDistance(lastPosition[0],lastPosition[1],latitude,longitude);
      distance += seg;
      distanceDisplay.textContent = distance.toFixed(2);
      if(speed){
        const kmh = speed*3.6;
        maxSpeedDisplay.textContent = Math.max(kmh, parseFloat(maxSpeedDisplay.textContent)) .toFixed(1) + " km/h";
      }
      if(altitude) elevationDisplay.textContent = Math.round(altitude);
      if(Math.floor(distance)>kmAnnounced){
        kmAnnounced = Math.floor(distance);
        speak(`Kilómetro ${kmAnnounced} completado`);
      }
      routeLine.setLatLngs(routePoints);
    }
  },err=>{
    gpsStatus.textContent="Error";
    statusText.textContent="Error GPS";
  },{
    enableHighAccuracy:true,maximumAge:0,timeout:5000
  });
}

function startTracking(){
  if(isTracking&&!isPaused)return;
  if(!isTracking){
    routePoints=[];distance=0;elapsedTime=0;kmAnnounced=0;lastPosition=null;
    routeLine.setLatLngs([]);
    distanceDisplay.textContent="0.00";paceDisplay.textContent="0:00";
    caloriesDisplay.textContent="0";elevationDisplay.textContent="0";
    avgSpeedDisplay.textContent="0.0 km/h";maxSpeedDisplay.textContent="0.0 km/h";
    avgPaceDisplay.textContent="0:00 min/km";
  }
  startTime=Date.now()-elapsedTime;
  isTracking=true;isPaused=false;
  watchId=watchPosition();
  timerInterval = setInterval(updateTimer,1000);
  startBtn.classList.add("hidden");
  pauseBtn.classList.remove("hidden");
  stopBtn.classList.remove("hidden");
  statusText.textContent="Actividad en progreso";
  statusText.classList.add("pulse");
}
function pauseTracking(){
  if(!isTracking||isPaused)return;
  clearInterval(timerInterval);
  isPaused=true;
  if(watchId!==null) navigator.geolocation.clearWatch(watchId);
  pauseBtn.classList.add("hidden");
  startBtn.classList.remove("hidden");
  statusText.textContent="Actividad pausada";
  statusText.classList.remove("pulse");
}
function showTicket(){
  ticketContent.innerHTML = `
    <p><strong>Distancia:</strong> ${distance.toFixed(2)} km</p>
    <p><strong>Tiempo:</strong> ${formatTime(elapsedTime)}</p>
    <p><strong>Ritmo prom:</strong> ${avgPaceDisplay.textContent} min/km</p>
    <p class="mt-3 text-sm text-gray-600">¡Gracias por usar RunTracker!</p>`;
  ticketModal.classList.remove("hidden");
}
function closeTicket(){ ticketModal.classList.add("hidden"); }

function stopTracking(){
  if(!isTracking)return;
  clearInterval(timerInterval);
  if(watchId!==null) navigator.geolocation.clearWatch(watchId);
  isTracking=false;isPaused=false;
  startBtn.classList.remove("hidden");
  pauseBtn.classList.add("hidden");
  stopBtn.classList.add("hidden");
  statusText.textContent="Actividad finalizada";
  statusText.classList.remove("pulse");
  showTicket();
}

// Eventos
document.addEventListener("DOMContentLoaded", initMap);
startBtn.addEventListener("click", startTracking);
pauseBtn.addEventListener("click", pauseTracking);
stopBtn.addEventListener("click", stopTracking);
closeTicketBtn.addEventListener("click", closeTicket);



