let map;
let watchId;
let path = [];
let polyline;
let startTime;
let interval;
let kmCount = 0;
let audio = new SpeechSynthesisUtterance();
audio.lang = "es-ES";

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const timerEl = document.getElementById("timer");

startBtn.addEventListener("click", startRun);
stopBtn.addEventListener("click", stopRun);

function initMap(position) {
    const { latitude, longitude } = position.coords;
    const center = { lat: latitude, lng: longitude };
    map = new google.maps.Map(document.getElementById("map"), {
        zoom: 17,
        center,
        styles: [{ elementType: "geometry", stylers: [{ color: "#000000" }] }],
        disableDefaultUI: true
    });

    polyline = new google.maps.Polyline({
        map,
        path: [],
        geodesic: true,
        strokeColor: "#ffcc00",
        strokeOpacity: 1.0,
        strokeWeight: 5
    });
}

function startRun() {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    path = [];
    kmCount = 0;
    startTime = Date.now();

    navigator.geolocation.getCurrentPosition(initMap, console.error, {
        enableHighAccuracy: true
    });

    watchId = navigator.geolocation.watchPosition(updatePosition, console.error, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
    });

    interval = setInterval(updateTimer, 1000);
}

function stopRun() {
    navigator.geolocation.clearWatch(watchId);
    clearInterval(interval);
    startBtn.disabled = false;
    stopBtn.disabled = true;
}

function updatePosition(position) {
    const { latitude, longitude } = position.coords;
    const latLng = new google.maps.LatLng(latitude, longitude);
    path.push(latLng);

    if (polyline) {
        const oldPath = polyline.getPath();
        oldPath.push(latLng);
        polyline.setPath(oldPath);
        map.panTo(latLng);
    }

    // Calcular distancia total
    let totalDistance = 0;
    for (let i = 1; i < path.length; i++) {
        totalDistance += google.maps.geometry.spherical.computeDistanceBetween(
            path[i - 1],
            path[i]
        );
    }

    // Anunciar cada kilómetro
    const kmCompleted = Math.floor(totalDistance / 1000);
    if (kmCompleted > kmCount) {
        kmCount = kmCompleted;
        const elapsed = (Date.now() - startTime) / 1000;
        const pace = elapsed / kmCount;
        const min = Math.floor(pace / 60);
        const sec = Math.floor(pace % 60);
        speak(`Kilómetro ${kmCount} completado en ${min} minutos y ${sec} segundos.`);
    }
}

function updateTimer() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const seconds = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = `${minutes}:${seconds}`;
}

function speak(text) {
    audio.text = text;
    window.speechSynthesis.speak(audio);
}
