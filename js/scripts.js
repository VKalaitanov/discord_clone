// Включи логи, если нужно: window.DEBUG_SPEECH = true;
window.DEBUG_SPEECH = true;
let localStream = null;
let ws = null;
let clientId = null;
let isMuted = false;

const peers = {};
const peerElements = {};
const speakingLoops = {}; // чтобы не запускать два монитора на одного пира

const joinBtn  = document.getElementById("join");
const leaveBtn = document.getElementById("leave");
const muteBtn  = document.getElementById("muteBtn");
const roomInput = document.getElementById("room");
const peersList = document.getElementById("peersList");

let audioContext;
function getAudioCtx() {
    if (!audioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        audioContext = new Ctx();
    }
    if (audioContext.state === "suspended") {
        audioContext.resume();
    }
    return audioContext;
}

function wsURL(roomId) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/ws/${roomId}`;
}

async function startLocalStream() {
    localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { width: 640, height: 480 }
    });

    const localVideo = document.getElementById("localVideo");
    localVideo.srcObject = localStream;
}


/** Детектор речи на RMS с гистерезисом и VU-индикатором */
function monitorSpeaking(peerId, stream) {
    if (speakingLoops[peerId]) return; // уже запущен

    const ctx = getAudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;                 // длина массива для time-domain
    analyser.smoothingTimeConstant = 0.7;    // сглаживание
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);

    const high = 0.045; // порог "заговорил"
    const low  = 0.020; // порог "замолчал"
    let speaking = false;
    let aboveCount = 0, belowCount = 0; // гистерезис по кадрам
    let lastLog = 0;

    const peerDiv = () => document.getElementById("peer-" + peerId);
    const micIcon = () => document.getElementById("mic-" + peerId);
    const vuFill  = () => document.getElementById("vu-" + peerId);

    function loop(ts) {
        analyser.getByteTimeDomainData(data);

        // RMS в [0..~0.5]
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);

        // шкала для VU (0..100%)
        const level = Math.min(100, Math.round(rms * 2200)); // эмпирически
        const fill = vuFill();
        if (fill) fill.style.width = level + "%";

        // гистерезис
        if (rms > high) { aboveCount++; belowCount = 0; }
        else if (rms < low) { belowCount++; aboveCount = 0; }

        if (!speaking && aboveCount >= 3) { // 3 подряд (≈50мс)
            speaking = true;
            const el = peerDiv(); const mic = micIcon();
            if (el) el.classList.add("talking");
            if (mic) mic.style.color = "var(--success)";
        } else if (speaking && belowCount >= 8) { // 8 подряд (≈130мс)
            speaking = false;
            const el = peerDiv(); const mic = micIcon();
            if (el) el.classList.remove("talking");
            if (mic) mic.style.color = "var(--text-muted)";
        }

        if (window.DEBUG_SPEECH && ts - lastLog > 200) {
            lastLog = ts;
            // Логи не спамят консоль
            console.debug(`[speaking] peer=${peerId} rms=${rms.toFixed(3)} level=${level}% speaking=${speaking}`);
        }

        speakingLoops[peerId] = requestAnimationFrame(loop);
    }

    speakingLoops[peerId] = requestAnimationFrame(loop);
}

function stopMonitor(peerId) {
    if (speakingLoops[peerId]) {
        cancelAnimationFrame(speakingLoops[peerId]);
        delete speakingLoops[peerId];
    }
}

function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.onicecandidate = e => {
        if (e.candidate) {
            ws?.send(JSON.stringify({ type: "candidate", candidate: e.candidate, to: peerId, from: clientId }));
        }
    };

    pc.ontrack = e => {
        const kind = e.track.kind;
        const stream = e.streams[0];

        if (kind === "video") {
            const video = document.getElementById("video-" + peerId);
            if (video) video.srcObject = stream;
        } else if (kind === "audio") {
            const audio = document.getElementById("audio-" + peerId);
            if (audio) audio.srcObject = stream;
            monitorSpeaking(peerId, stream);
        }
    };

    return pc;
}


async function sendOffer(peerId) {
    const pc = peers[peerId];
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws?.send(JSON.stringify({ ...offer, to: peerId, from: clientId }));
}

function addPeerUI(peerId, isLocal = false) {
    if (peerElements[peerId]) return;

    const div = document.createElement("div");
    div.className = "peer";
    div.id = "peer-" + peerId;

    div.innerHTML = `
        <video id="video-${peerId}" autoplay playsinline ${isLocal ? "muted" : ""}></video>
        <audio id="audio-${peerId}" autoplay playsinline ${isLocal ? "muted" : ""}></audio>
        <div class="info">
            <span class="peer-id">${isLocal ? "Вы" : peerId}</span>
            <span class="mic" id="mic-${peerId}">🎤</span>
            <div class="vu"><div class="fill" id="vu-${peerId}"></div></div>
        </div>
        ${isLocal ? `
        <div class="controls">
            <button id="mute-${peerId}">Выключить микрофон</button>
            <button id="video-${peerId}-btn">Выключить видео</button>
        </div>` : ""}
    `;

    peersList.appendChild(div);
    peerElements[peerId] = div;

    // Для локального пользователя навешиваем обработчики
    if (isLocal) {
        const muteBtn = document.getElementById("mute-" + peerId);
        const videoBtn = document.getElementById("video-" + peerId + "-btn");

        let isMuted = false;
        let isVideoOff = false;

        muteBtn.addEventListener("click", () => {
            if (!localStream) return;
            isMuted = !isMuted;
            localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
            muteBtn.textContent = isMuted ? "Включить микрофон" : "Выключить микрофон";
        });

        videoBtn.addEventListener("click", () => {
            if (!localStream) return;
            isVideoOff = !isVideoOff;
            localStream.getVideoTracks().forEach(t => t.enabled = !isVideoOff);
            videoBtn.textContent = isVideoOff ? "Включить видео" : "Выключить видео";
        });
    }
}


function removePeerUI(peerId) {
    stopMonitor(peerId);
    const div = peerElements[peerId];
    if (div) div.remove();
    delete peerElements[peerId];

    const audio = document.getElementById("audio-" + peerId);
    if (audio) audio.remove();

    const video = document.getElementById("video-" + peerId);
    if (video) video.remove();
}


async function joinRoom() {
    const roomId = roomInput.value.trim();
    if (!roomId) return alert("Введите Room ID");

    await startLocalStream();
    getAudioCtx(); // разблокируем AudioContext

    ws = new WebSocket(wsURL(roomId));
    ws.onmessage = async evt => {
        const msg = JSON.parse(evt.data);
        const { type, from, candidate } = msg;

        if (type === "id") {
            clientId = msg.id;
            addPeerUI(clientId, true);

            const localVideo = document.getElementById("video-" + clientId);
            if (localVideo) localVideo.srcObject = localStream;

            const audioStream = new MediaStream(localStream.getAudioTracks());
            monitorSpeaking(clientId, audioStream);
        } else if (type === "new-peer") {
            const newId = msg.id;
            addPeerUI(newId);
            if (!peers[newId]) {
                peers[newId] = createPeerConnection(newId);
                sendOffer(newId);
            }
        } else if (type === "peer-left") {
            const leftId = msg.id;
            if (peers[leftId]) {
                peers[leftId].close();
                delete peers[leftId];
            }
            removePeerUI(leftId);
        } else if (from === clientId) {
            return;
        }

        if (!from) return;

        if (!peers[from]) peers[from] = createPeerConnection(from);
        const pc = peers[from];

        if (type === "offer") {
            addPeerUI(from);
            await pc.setRemoteDescription(new RTCSessionDescription(msg));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws?.send(JSON.stringify({ ...answer, to: from, from: clientId }));
        } else if (type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(msg));
        } else if (type === "candidate") {
            try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
            catch (e) { console.error(e); }
        }
    };

    joinBtn.disabled = true;
    leaveBtn.disabled = false;
    roomInput.disabled = true;
}


function leaveRoom() {
    if (ws) {
        ws.close();
        ws = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    const localVideo = document.getElementById("localVideo");
    if (localVideo) {
        localVideo.srcObject = null;
    }

    Object.values(peers).forEach(pc => pc.close());
    Object.keys(peers).forEach(k => delete peers[k]);
    Object.keys(peerElements).forEach(removePeerUI);

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    joinBtn.disabled = false;
    leaveBtn.disabled = true;
    muteBtn.disabled = true;
    roomInput.disabled = false;
}

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    muteBtn.textContent = isMuted ? "Включить микрофон" : "Выключить микрофон";
}

joinBtn.addEventListener("click", joinRoom);
leaveBtn.addEventListener("click", leaveRoom);
muteBtn.addEventListener("click", toggleMute);
