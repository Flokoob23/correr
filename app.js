// Variables globales
let map;
let userMarker = null;
let routePolyline;
let watchId = null;
let timerInterval = null;

let hasLocationPermission = false;
let isTracking = false;
let isPaused = false;

let startTime = null;
let pauseTime = null;

let trackPoints = [];
let laps = [];
let splits = [];
let currentSplit = 0;

let totalDistance = 0;
let elevationGain = 0;
let lastPosition = null;

let paceChart = null;
let elevationChart = null;

// Inicializar mapa y elementos
function initMap() {
    map = L.map('map').setView([0, 0], 13);

    const osmLayer = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }
    ).addTo(map);

    routePolyline = L.polyline([], { color: '#FFD700' }).addTo(map);
}

// Inicializar ubicación
function initializeLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            position => {
                const { latitude, longitude } = position.coords;
                map.setView([latitude, longitude], 15);

                // Crear marcador del usuario
                if (userMarker) {
                    userMarker.setLatLng([latitude, longitude]);
                } else {
                    userMarker = L.marker([latitude, longitude], {
                        icon: L.divIcon({
                            className: 'user-marker',
                            html: `<div style="background-color: #FFD700; border: 2px solid #121212; border-radius: 50%; width: 16px; height: 16px;"></div>`,
                            iconSize: [16, 16],
                            iconAnchor: [8, 8]
                        })
                    }).addTo(map);
                }

                lastPosition = {
                    lat: latitude,
                    lng: longitude,
                    elevation: position.coords.altitude || 0,
                    time: new Date()
                };

                document.getElementById('location-permission').classList.add('hidden');
                hasLocationPermission = true;
            },
            error => {
                console.error('Error al obtener la ubicación:', error);
                document.getElementById('location-permission').classList.remove('hidden');
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    } else {
        alert('Tu navegador no soporta geolocalización.');
    }
}

// Configurar event listeners
function setupEventListeners() {
    document.getElementById('requestLocationBtn').addEventListener('click', () => {
        initializeLocation();
    });

    document.getElementById('startBtn').addEventListener('click', startTracking);
    document.getElementById('pauseBtn').addEventListener('click', pauseTracking);
    document.getElementById('stopBtn').addEventListener('click', stopTracking);
    document.getElementById('lapBtn').addEventListener('click', markLap);
    document.getElementById('layerBtn').addEventListener('click', () => {
        document.querySelector('.leaflet-control-layers').classList.toggle('leaflet-control-layers-expanded');
    });

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Desactivar todos los tabs
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));

            // Activar tab seleccionado
            btn.classList.add('tab-active');
            document.getElementById(`${btn.dataset.tab}-tab`).classList.remove('hidden');
        });
    });

    document.getElementById('saveActivityBtn').addEventListener('click', saveActivity);
}

// Iniciar seguimiento
function startTracking() {
    if (!hasLocationPermission) {
        initializeLocation();
        return;
    }

    if (isPaused) {
        isPaused = false;
        const pauseDuration = new Date() - pauseTime;
        startTime = new Date(startTime.getTime() + pauseDuration);
    } else if (!isTracking) {
        startTime = new Date();

        if (trackPoints.length === 0 || confirm('¿Iniciar una nueva actividad? Se perderán los datos actuales.')) {
            trackPoints = [];
            splits = [];
            laps = [];
            currentSplit = 0;
            totalDistance = 0;
            elevationGain = 0;
            routePolyline.setLatLngs([]);
            updateSplitsTable();
            updateStats();
        }
    }

    isTracking = true;

    // UI
    document.getElementById('startBtn').disabled = true;
    document.getElementById('pauseBtn').disabled = false;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('lapBtn').disabled = false;

    // Cronómetro
    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);

    // Seguimiento GPS
    watchId = navigator.geolocation.watchPosition(
        updatePosition,
        error => {
            console.error('Error al seguir la ubicación:', error);
            alert('Error al seguir tu ubicación. Por favor, verifica los permisos.');
            pauseTracking();
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        }
    );
}

// Pausar seguimiento
function pauseTracking() {
    if (isTracking && !isPaused) {
        isPaused = true;
        pauseTime = new Date();

        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }

        clearInterval(timerInterval);

        document.getElementById('startBtn').disabled = false;
        document.getElementById('startBtn').textContent = 'Reanudar';
        document.getElementById('pauseBtn').disabled = true;
    }
}

// Detener seguimiento
function stopTracking() {
    if (isTracking) {
        isTracking = false;
        isPaused = false;

        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }

        clearInterval(timerInterval);

        document.getElementById('startBtn').disabled = false;
        document.getElementById('startBtn').textContent = 'Iniciar';
        document.getElementById('pauseBtn').disabled = true;
        document.getElementById('stopBtn').disabled = true;
        document.getElementById('lapBtn').disabled = true;

        // Mostrar resumen
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        document.querySelector('[data-tab="summary"]').classList.add('tab-active');
        document.getElementById('summary-tab').classList.remove('hidden');
    }
}

// Marcar parcial manual
function markLap() {
    if (!isTracking || isPaused) return;

    const lapTime = new Date() - startTime;
    const lapDistance = totalDistance;

    const lastLapTime = laps.length > 0 ?
        lapTime - laps[laps.length - 1].totalTime :
        lapTime;

    const lastLapDistance = laps.length > 0 ?
        lapDistance - laps[laps.length - 1].totalDistance :
        lapDistance;

    let lapPace = 0;
    let lapPaceString = "--'--\"";

    if (lastLapDistance > 0) {
        lapPace = (lastLapTime / 1000 / 60) / lastLapDistance;
        const lapPaceMinutes = Math.floor(lapPace);
        const lapPaceSeconds = Math.floor((lapPace - lapPaceMinutes) * 60);
        lapPaceString = lapPaceMinutes + "'" + (lapPaceSeconds < 10 ? '0' : '') + lapPaceSeconds + '"';
    }

    laps.push({
        number: laps.length + 1,
        totalTime: lapTime,
        lapTime: lastLapTime,
        totalDistance: lapDistance,
        lapDistance: lastLapDistance,
        pace: lapPaceString,
        elevation: Math.round(elevationGain)
    });

    updateLapsTable();
}

// Actualizar posición usuario
function updatePosition(position) {
    const { latitude, longitude } = position.coords;
    const elevation = position.coords.altitude || 0;
    const timestamp = new Date();

    // Actualizar marcador
    if (userMarker) {
        userMarker.setLatLng([latitude, longitude]);
    } else {
        userMarker = L.marker([latitude, longitude], {
            icon: L.divIcon({
                className: 'user-marker',
                html: `<div style="background-color: #FFD700; border: 2px solid #121212; border-radius: 50%; width: 16px; height: 16px;"></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            })
        }).addTo(map);
    }

    trackPoints.push({
        lat: latitude,
        lng: longitude,
        elevation: elevation,
        time: timestamp
    });

    routePolyline.addLatLng([latitude, longitude]);

    map.panTo([latitude, longitude]);

    if (lastPosition) {
        const segmentDistance = calculateDistance(
            lastPosition.lat, lastPosition.lng,
            latitude, longitude
        );

        if (segmentDistance < 0.1) {
            totalDistance += segmentDistance;

            if (elevation > lastPosition.elevation) {
                elevationGain += (elevation - lastPosition.elevation);
            }

            updateStats();
            checkSplits();
        }
    }

    lastPosition = {
        lat: latitude,
        lng: longitude,
        elevation: elevation,
        time: timestamp
    };
}

// Calcular distancia entre dos puntos (Haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Actualizar cronómetro
function updateTimer() {
    if (!startTime) return;

    const now = new Date();
    const elapsed = isPaused ? pauseTime - startTime : now - startTime;

    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    const timeString =
        (hours < 10 ? '0' + hours : hours) + ':' +
        (minutes < 10 ? '0' + minutes : minutes) + ':' +
        (seconds < 10 ? '0' + seconds : seconds);

    document.getElementById('activity-duration').textContent = timeString;
}

// Actualizar estadísticas
function updateStats() {
    // Distancia
    document.getElementById('activity-distance').textContent = totalDistance.toFixed(2) + ' km';

    // Ritmo
    if (totalDistance > 0 && startTime) {
        const elapsed = isPaused ?
            (pauseTime - startTime) / 1000 :
            (new Date() - startTime) / 1000; // segundos

        const pace = elapsed / (totalDistance * 60); // min/km
        const paceMinutes = Math.floor(pace);
        const paceSeconds = Math.floor((pace - paceMinutes) * 60);

        const paceString = paceMinutes + "'" + (paceSeconds < 10 ? '0' : '') + paceSeconds + '"';
        document.getElementById('activity-pace').textContent = paceString;
    } else {
        document.getElementById('activity-pace').textContent = "--'--\"";
    }

    // Calorías (estimación)
    const calories = Math.round(totalDistance * 65);
    document.getElementById('activity-calories').textContent = calories + ' kcal';

    // Desnivel
    const elevationRounded = Math.round(elevationGain);
    document.getElementById('activity-elevation').textContent = elevationRounded + ' m';

    // Actualizar gráficos
    if (trackPoints.length > 1) {
        updateCharts();
    }
}

// Comprobar splits (cada km)
function checkSplits() {
    if (totalDistance >= (currentSplit + 1)) {
        const splitTime = isPaused ?
            pauseTime - startTime :
            new Date() - startTime;

        const splitPace = splitTime / ((currentSplit + 1) * 60000);
        const splitPaceMinutes = Math.floor(splitPace);
        const splitPaceSeconds = Math.floor((splitPace - splitPaceMinutes) * 60);

        splits.push({
            km: currentSplit + 1,
            time: formatTime(splitTime),
            pace: splitPaceMinutes + "'" + (splitPaceSeconds < 10 ? '0' : '') + splitPaceSeconds + '"',
            elevation: Math.round(elevationGain)
        });

        updateSplitsTable();
        currentSplit++;
    }
}

// Actualizar tabla splits
function updateSplitsTable() {
    const tbody = document.getElementById('splits-body');
    tbody.innerHTML = '';

    if (splits.length === 0 && laps.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="4">No hay parciales registrados</td>`;
        tbody.appendChild(row);
        return;
    }

    splits.forEach(split => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>Km ${split.km}</td>
            <td>${split.time}</td>
            <td>${split.pace}</td>
            <td>${split.elevation} m</td>
        `;
        tbody.appendChild(row);
    });

    laps.forEach(lap => {
        const row = document.createElement('tr');
        row.classList.add('bg-yellow-900');
        row.innerHTML = `
            <td>Vuelta ${lap.number} (${lap.lapDistance.toFixed(2)} km)</td>
            <td>${formatTime(lap.lapTime)}</td>
            <td>${lap.pace}</td>
            <td>${lap.elevation} m</td>
        `;
        tbody.appendChild(row);
    });
}

// Los laps se muestran en la misma tabla que splits
function updateLapsTable() {
    updateSplitsTable();
}

// Formatear tiempo ms a HH:MM:SS
function formatTime(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    return (hours > 0 ? hours + ':' : '') +
        (minutes < 10 ? '0' + minutes : minutes) + ':' +
        (seconds < 10 ? '0' + seconds : seconds);
}

// Configurar gráficos Chart.js
function setupCharts() {
    const paceCtx = document.getElementById('paceChart').getContext('2d');
    paceChart = new Chart(paceCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Ritmo (min/km)',
                data: [],
                borderColor: '#FFD700',
                backgroundColor: 'rgba(255, 215, 0, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    reverse: true,
                    ticks: { color: '#F5F5F5' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                x: {
                    ticks: { color: '#F5F5F5' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            },
            plugins: {
                legend: { labels: { color: '#F5F5F5' } }
            }
        }
    });

    const elevationCtx = document.getElementById('elevationChart').getContext('2d');
    elevationChart = new Chart(elevationCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Elevación (m)',
                data: [],
                borderColor: '#FFD700',
                backgroundColor: 'rgba(255, 215, 0, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    ticks: { color: '#F5F5F5' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                x: {
                    ticks: { color: '#F5F5F5' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            },
            plugins: {
                legend: { labels: { color: '#F5F5F5' } }
            }
        }
    });
}

// Actualizar gráficos
function updateCharts() {
    if (trackPoints.length < 2) return;

    const labels = [];
    const paceData = [];
    const elevationData = [];

    const step = Math.max(1, Math.floor(trackPoints.length / 20));

    for (let i = 0; i < trackPoints.length; i += step) {
        const point = trackPoints[i];

        const distance = (i / trackPoints.length * totalDistance).toFixed(1);
        labels.push(distance + ' km');

        if (i > 0) {
            const prevPoint = trackPoints[i - step];
            const segmentDistance = calculateDistance(
                prevPoint.lat, prevPoint.lng,
                point.lat, point.lng
            );

            const segmentTime = (point.time - prevPoint.time) / 1000 / 60; // minutos

            if (segmentDistance > 0) {
                const pace = segmentTime / segmentDistance; // min/km
                paceData.push(pace);
            } else {
                paceData.push(paceData.length > 0 ? paceData[paceData.length - 1] : 5);
            }
        } else {
            paceData.push(5);
        }

        elevationData.push(point.elevation || 0);
    }

    paceChart.data.labels = labels;
    paceChart.data.datasets[0].data = paceData;
    paceChart.update();

    elevationChart.data.labels = labels;
    elevationChart.data.datasets[0].data = elevationData;
    elevationChart.update();
}

// Guardar actividad (simulado)
function saveActivity() {
    if (trackPoints.length > 0) {
        alert('¡Actividad guardada con éxito!');
    } else {
        alert('No hay datos de actividad para guardar.');
    }
}

// Actualizar fecha actividad
function updateActivityDate() {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();

    document.getElementById('activity-date').textContent = `${day}/${month}/${year}`;
}

// Arranque
window.onload = () => {
    initMap();
    initializeLocation();
    setupEventListeners();
    setupCharts();
    updateActivityDate();
};
