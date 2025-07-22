// Variables globales
let map, positionMarker, routeLine;
let routePoints = [];
let lastPosition = null;
let distance = 0; // en km
let elapsedTime = 0; // en ms
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

// Inicialización Leaflet
function initMap() {
    map = L.map("map").setView([-34.6037, -58.3816], 15); // Buenos Aires por defecto
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    positionMarker = L.circleMarker([0, 0], {
        radius: 7,
        color: "#4f46e5",
        fillColor: "#6366f1",
        fillOpacity: 0.8,
    }).addTo(map);

    positionMarker.setLatLng([-34.6037, -58.3816]);
}

// Calcula distancia en km entre 2 coords lat/lng con Haversine
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRad(value) {
    return value * Math.PI / 180;
}

// Formatear tiempo hh:mm:ss
function formatTime(ms) {
    let totalSeconds = Math.floor(ms / 1000);
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds - hours * 3600) / 60);
    let seconds = totalSeconds % 60;

    return [
        hours.toString().padStart(2, "0"),
        minutes.toString().padStart(2, "0"),
        seconds.toString().padStart(2, "0"),
    ].join(":");
}

// Formatear ritmo min/km mm:ss
function formatPace(pace) {
    if (!isFinite(pace) || pace === 0) return "0:00";
    const min = Math.floor(pace);
    const sec = Math.round((pace - min) * 60);
    return `${min}:${sec.toString().padStart(2, "0")}`;
}

// Función voz sintetizada
function speak(text) {
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(utterance);
    }
}

// Actualiza la pantalla del temporizador
function updateTimer() {
    elapsedTime = Date.now() - startTime;
    timerDisplay.textContent = formatTime(elapsedTime);

    if (distance > 0) {
        const paceMinPerKm = (elapsedTime / 1000) / 60 / distance; // min/km
        paceDisplay.textContent = formatPace(paceMinPerKm);
        avgPaceDisplay.textContent = formatPace(paceMinPerKm);

        const speedKmh = distance / (elapsedTime / 3600000);
        avgSpeedDisplay.textContent = speedKmh.toFixed(1) + " km/h";

        const calories = Math.round(distance * 65); // aprox.
        caloriesDisplay.textContent = calories.toString();
    }
}

// Control GPS y seguimiento

function watchPosition() {
    if (!isTracking) return null;

    return navigator.geolocation.watchPosition(
        position => {
            gpsStatus.textContent = "Conectado";
            gpsStatus.classList.remove("text-red-500");

            const { latitude, longitude, altitude, speed } = position.coords;
            const currentPos = { lat: latitude, lng: longitude };

            positionMarker.setLatLng([latitude, longitude]);
            map.setView([latitude, longitude], map.getZoom());

            routePoints.push([latitude, longitude]);

            if (routeLine) {
                map.removeLayer(routeLine);
            }
            routeLine = L.polyline(routePoints, { color: "#4f46e5", weight: 5 }).addTo(map);

            if (lastPosition) {
                const segmentDistance = calculateDistance(
                    lastPosition.lat,
                    lastPosition.lng,
                    latitude,
                    longitude
                );
                distance += segmentDistance;
                distanceDisplay.textContent = distance.toFixed(2);

                // Calcular ritmo y velocidad
                const currentSpeedKmh = speed ? speed * 3.6 : 0;
                if (currentSpeedKmh > parseFloat(maxSpeedDisplay.textContent)) {
                    maxSpeedDisplay.textContent = currentSpeedKmh.toFixed(1) + " km/h";
                }

                // Elevación
                if (altitude) {
                    elevationDisplay.textContent = Math.round(altitude);
                }

                // Anunciar cada km completado
                if (Math.floor(distance) > kmAnnounced) {
                    kmAnnounced = Math.floor(distance);
                    speak(`Kilómetro ${kmAnnounced} completado`);
                }
            }

            lastPosition = currentPos;
        },
        error => {
            gpsStatus.textContent = "Error";
            gpsStatus.classList.add("text-red-500");
            statusText.textContent = "Error de seguimiento GPS";
            console.error("Error GPS:", error);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
}

// Inicia seguimiento y timer
function startTracking() {
    if (isTracking && !isPaused) return;

    if (!isTracking) {
        // Reset inicial
        routePoints = [];
        distance = 0;
        kmAnnounced = 0;
        elapsedTime = 0;
        lastPosition = null;
        if (routeLine) {
            map.removeLayer(routeLine);
            routeLine = null;
        }
        distanceDisplay.textContent = "0.00";
        paceDisplay.textContent = "0:00";
        caloriesDisplay.textContent = "0";
        elevationDisplay.textContent = "0";
        avgSpeedDisplay.textContent = "0.0 km/h";
        maxSpeedDisplay.textContent = "0.0 km/h";
        avgPaceDisplay.textContent = "0:00 min/km";
    }

    startTime = Date.now() - elapsedTime;
    isTracking = true;
    isPaused = false;

    watchId = watchPosition();

    timerInterval = setInterval(updateTimer, 1000);

    // UI
    startBtn.classList.add("hidden");
    pauseBtn.classList.remove("hidden");
    stopBtn.classList.remove("hidden");
    statusText.textContent = "Actividad en progreso";
    statusText.classList.add("pulse");
}

// Pausar seguimiento y timer
function pauseTracking() {
    if (!isTracking || isPaused) return;
    clearInterval(timerInterval);
    isPaused = true;

    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    startBtn.classList.remove("hidden");
    pauseBtn.classList.add("hidden");
    statusText.textContent = "Actividad pausada";
    statusText.classList.remove("pulse");
}

// Detener actividad y mostrar resumen
function stopTracking() {
    if (!isTracking) return;

    clearInterval(timerInterval);
    isTracking = false;
    isPaused = false;
    elapsedTime = 0;

    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    startBtn.classList.remove("hidden");
    pauseBtn.classList.add("hidden");
    stopBtn.classList.add("hidden");
    statusText.textContent = "Actividad finalizada";
    statusText.classList.remove("pulse");

    alert(`¡Actividad finalizada!\nDistancia: ${distance.toFixed(2)} km\nTiempo: ${formatTime(elapsedTime)}\nRitmo medio: ${avgPaceDisplay.textContent}`);
}

// Eventos botones
startBtn.addEventListener("click", startTracking);
pauseBtn.addEventListener("click", pauseTracking);
stopBtn.addEventListener("click", stopTracking);

// Inicializar mapa
initMap();

