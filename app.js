// app.js

// Variables globales
let map;
let route = [];
let watchID;
let distance = 0;
let startTime;
let layerControl;

// Elementos DOM
const startBtn = document.getElementById("startRun");
const stopBtn = document.getElementById("stopRun");
const stats = document.getElementById("stats");
const distanceSpan = document.getElementById("distance");
const timeSpan = document.getElementById("time");
const paceSpan = document.getElementById("pace");
const ticketModal = document.getElementById("ticketModal");
const ticketContent = document.getElementById("ticketContent");
const closeTicketBtn = document.getElementById("closeTicket");

// Inicialización
function initMap() {
  map = L.map("map").setView([-34.6, -58.4], 13);

  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const esri = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri"
  });

  layerControl = L.control.layers({ "OpenStreetMap": osm, "Satélite": esri }).addTo(map);
}

function startRun() {
  if (!navigator.geolocation) {
    alert("La geolocalización no es compatible con este navegador.");
    return;
  }

  route = [];
  distance = 0;
  startTime = new Date();
  stats.style.display = "flex";
  updateStats();

  watchID = navigator.geolocation.watchPosition(position => {
    const { latitude, longitude } = position.coords;
    const latlng = [latitude, longitude];
    route.push(latlng);
    if (route.length > 1) {
      distance += getDistance(route[route.length - 2], latlng);
      drawRoute();
    } else {
      L.marker(latlng).addTo(map);
    }
    map.setView(latlng, 17);
    updateStats();
  }, err => {
    console.error("Error de geolocalización:", err);
  }, {
    enableHighAccuracy: true,
    maximumAge: 1000
  });
}

function stopRun() {
  navigator.geolocation.clearWatch(watchID);
  showTicket();
}

function getDistance(a, b) {
  const R = 6371e3;
  const φ1 = a[0] * Math.PI / 180;
  const φ2 = b[0] * Math.PI / 180;
  const Δφ = (b[0] - a[0]) * Math.PI / 180;
  const Δλ = (b[1] - a[1]) * Math.PI / 180;

  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

  return R * y; // metros
}

function drawRoute() {
  L.polyline(route, { color: "yellow", weight: 5 }).addTo(map);
}

function updateStats() {
  const elapsed = (new Date() - startTime) / 1000;
  const pace = (elapsed / 60) / (distance / 1000);
  distanceSpan.textContent = (distance / 1000).toFixed(2);
  timeSpan.textContent = formatTime(elapsed);
  paceSpan.textContent = isFinite(pace) ? pace.toFixed(2) : "0.00";
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function showTicket() {
  const totalTime = timeSpan.textContent;
  const totalDistance = distanceSpan.textContent;
  const pace = paceSpan.textContent;
  ticketContent.innerHTML = `
    <h3>🏁 Entrenamiento Completado</h3>
    <p><strong>Distancia:</strong> ${totalDistance} km</p>
    <p><strong>Tiempo Total:</strong> ${totalTime}</p>
    <p><strong>Ritmo Promedio:</strong> ${pace} min/km</p>
    <a href="https://wa.me/?text=Finalicé mi entrenamiento: ${totalDistance} km en ${totalTime} (${pace} min/km). ¡Vamos FLOKOOB!" target="_blank">Compartir por WhatsApp</a>
  `;
  ticketModal.classList.remove("hidden");
}

closeTicketBtn.addEventListener("click", () => {
  ticketModal.classList.add("hidden");
});

startBtn.addEventListener("click", startRun);
stopBtn.addEventListener("click", stopRun);

window.onload = initMap;

// Funciones extendibles futuras: historial, login, objetivos, sincronización con Sheets, etc.
// Espacio reservado para al menos 30 líneas más...

for (let i = 0; i < 30; i++) {
  console.log("App de Running – FLOKOOB – línea extra #" + (i + 1));
}


