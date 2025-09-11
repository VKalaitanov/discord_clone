window.DEBUG_SPEECH = true;
let localStream = null;
let ws = null;
let clientId = null;

const peers = {};          // RTCPeerConnections
const peerElements = {};   // DOM карточки участников
const speakingLoops = {};  // Чтобы не запускать два монитора на одного пира

document.addEventListener("DOMContentLoaded", () => {
    const joinBtn  = document.getElementById("join");
    const leaveBtn = document.getElementById("leave");
    const roomInput = document.getElementById("room");
    const peersList = document.getElementById("peersList");

    joinBtn.addEventListener("click", () => joinRoom(roomInput, peersList, joinBtn, leaveBtn));
    leaveBtn.addEventListener("click", () => leaveRoom(joinBtn, leaveBtn, roomInput));
});

let audioContext;
function getAudioCtx() {
    if (!audioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        audioContext = new Ctx();
    }
    if (audioContext.state === "suspended") audioContext.resume();
    return audioContext;
}

function wsURL(roomId) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/ws/${roomId}`;
}

// ======== Локальный поток ========
async function startLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: { width: 640, height: 480 }
        });
        return localStream;
    } catch(e) {
        console.error("Ошибка доступа к камере/микрофону:", e);
        alert("Разрешите доступ к камере и микрофону");
    }
}

// ======== Мониторинг речи ========
function monitorSpeaking(peerId, stream) {
    if (speakingLoops[peerId]) return;
    const ctx = getAudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.7;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    const high = 0.045, low = 0.020;
    let speaking = false, aboveCount=0, belowCount=0, lastLog=0;

    const peerDiv = () => document.getElementById("peer-" + peerId);
    const micIcon = () => document.getElementById("mic-" + peerId);
    const vuFill  = () => document.getElementById("vu-" + peerId);

    function loop(ts){
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for(let i=0;i<data.length;i++){ const v=(data[i]-128)/128; sum+=v*v; }
        const rms = Math.sqrt(sum/data.length);
        const level = Math.min(100, Math.round(rms*2200));

        const fill = vuFill();
        if(fill) fill.style.width = level+"%";

        if(rms>high){ aboveCount++; belowCount=0; }
        else if(rms<low){ belowCount++; aboveCount=0; }

        if(!speaking && aboveCount>=3){
            speaking=true; peerDiv()?.classList.add("talking");
            if(micIcon()) micIcon().style.color="var(--success)";
        } else if(speaking && belowCount>=8){
            speaking=false; peerDiv()?.classList.remove("talking");
            if(micIcon()) micIcon().style.color="var(--text-muted)";
        }

        if(window.DEBUG_SPEECH && ts-lastLog>200){
            lastLog=ts;
            console.debug(`[speaking] peer=${peerId} rms=${rms.toFixed(3)} level=${level}% speaking=${speaking}`);
        }

        speakingLoops[peerId] = requestAnimationFrame(loop);
    }

    speakingLoops[peerId] = requestAnimationFrame(loop);
}

function stopMonitor(peerId){
    if(speakingLoops[peerId]){
        cancelAnimationFrame(speakingLoops[peerId]);
        delete speakingLoops[peerId];
    }
}

// ======== PeerConnection ========
function createPeerConnection(peerId){
    const pc = new RTCPeerConnection({ iceServers:[{urls:"stun:stun.l.google.com:19302"}] });
    if(localStream){
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = e=>{
        if(e.candidate) ws?.send(JSON.stringify({type:"candidate", candidate:e.candidate, to:peerId, from:clientId}));
    };

    pc.ontrack = e=>{
        const stream = e.streams[0];
        if(!document.getElementById("peer-"+peerId)){
            addPeerUI(peerId, document.getElementById("peersList"));
        }

        if(e.track.kind === "video"){
            const video = document.getElementById("video-"+peerId);
            if(video){
                video.srcObject = stream;
                video.autoplay = true;
                video.playsInline = true;
                video.muted = peerId===clientId;
                video.style.display = "block";
                video.play().catch(()=>{});
            }
        }

        if(e.track.kind === "audio"){
            const audio = document.getElementById("audio-"+peerId);
            if(audio){
                audio.srcObject = stream;
                audio.autoplay = true;
                audio.play().catch(()=>{});
            }
            monitorSpeaking(peerId, stream);
        }
    };

    return pc;
}

// ======== UI ========
function addPeerUI(peerId, peersList, isLocal=false){
    if(peerElements[peerId]) return;
    const div = document.createElement("div");
    div.className="peer"; div.id="peer-"+peerId;
    div.innerHTML=`
        <video id="video-${peerId}" autoplay playsinline ${isLocal?"muted":""}></video>
        <audio id="audio-${peerId}" autoplay playsinline ${isLocal?"muted":""}></audio>
        <div class="info">
            <span class="peer-id">${isLocal?"Вы":peerId}</span>
            <span class="mic" id="mic-${peerId}">🎤</span>
            <div class="vu"><div class="fill" id="vu-${peerId}"></div></div>
        </div>
        ${isLocal?`<div class="controls">
            <button id="mute-${peerId}">Выключить микрофон</button>
            <button id="video-${peerId}-btn">Выключить видео</button>
        </div>`:""}
    `;
    peersList.appendChild(div);
    peerElements[peerId]=div;

    if(isLocal){
        const muteBtn=document.getElementById("mute-"+peerId);
        const videoBtn=document.getElementById("video-"+peerId+"-btn");
        let isMuted=false, isVideoOff=false;

        muteBtn.addEventListener("click", ()=>{
            if(!localStream) return;
            isMuted=!isMuted;
            localStream.getAudioTracks().forEach(t=>t.enabled=!isMuted);
            muteBtn.textContent=isMuted?"Включить микрофон":"Выключить микрофон";
        });

        videoBtn.addEventListener("click", ()=>{
            if(!localStream) return;
            isVideoOff = !isVideoOff;

            const videoTrack = localStream.getVideoTracks()[0];
            if(videoTrack) videoTrack.enabled = !isVideoOff;

            const videoEl = document.getElementById(`video-${clientId}`);
            if(videoEl){
                videoEl.style.display = isVideoOff?"none":"block";
                if(!isVideoOff) videoEl.play().catch(()=>{});
            }

            Object.values(peers).forEach(pc=>{
                const sender = pc.getSenders().find(s=>s.track && s.track.kind==="video");
                if(sender) sender.replaceTrack(videoTrack);
            });

            videoBtn.textContent = isVideoOff?"Включить видео":"Выключить видео";
        });
    }
}

function removePeerUI(peerId){
    stopMonitor(peerId);
    const div=peerElements[peerId];
    if(div) div.remove();
    delete peerElements[peerId];
}

// ======== Join/Leave ========
async function joinRoom(roomInput, peersList, joinBtn, leaveBtn){
    const roomId = roomInput.value.trim();
    if(!roomId) return alert("Введите Room ID");
    await startLocalStream();
    getAudioCtx();

    ws = new WebSocket(wsURL(roomId));
    ws.onmessage = async evt=>{
        const msg = JSON.parse(evt.data);
        const {type, from, candidate} = msg;

        if(type==="id"){
            clientId=msg.id;
            addPeerUI(clientId, peersList, true);
            const localVideo=document.getElementById("video-"+clientId);
            if(localVideo) localVideo.srcObject=localStream;
            monitorSpeaking(clientId, new MediaStream(localStream.getAudioTracks()));

        } else if(type==="new-peer"){
            const newId=msg.id;
            addPeerUI(newId, peersList);
            if(!peers[newId]){
                peers[newId]=createPeerConnection(newId);
                sendOffer(newId);
            }
        } else if(type==="peer-left"){
            const leftId=msg.id;
            if(peers[leftId]) { peers[leftId].close(); delete peers[leftId]; }
            removePeerUI(leftId);
        } else if(!from || from===clientId) return;

        if(!peers[from]) peers[from]=createPeerConnection(from);
        const pc=peers[from];

        if(type==="offer"){
            addPeerUI(from, peersList);
            await pc.setRemoteDescription(new RTCSessionDescription(msg));
            const answer=await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws?.send(JSON.stringify({...answer, to:from, from:clientId}));
        } else if(type==="answer"){
            await pc.setRemoteDescription(new RTCSessionDescription(msg));
        } else if(type==="candidate"){
            try{ await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
            catch(e){ console.error(e); }
        }
    };

    joinBtn.disabled=true; leaveBtn.disabled=false; roomInput.disabled=true;
}

function leaveRoom(joinBtn, leaveBtn, roomInput){
    if(ws){ ws.close(); ws=null; }
    if(localStream){ localStream.getTracks().forEach(t=>t.stop()); localStream=null; }

    Object.values(peers).forEach(pc=>pc.close());
    Object.keys(peers).forEach(k=>delete peers[k]);
    Object.keys(peerElements).forEach(removePeerUI);

    if(audioContext){ audioContext.close(); audioContext=null; }

    joinBtn.disabled=false; leaveBtn.disabled=true; roomInput.disabled=false;
}

async function sendOffer(peerId){
    const pc=peers[peerId];
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws?.send(JSON.stringify({...offer, to:peerId, from:clientId}));
}
