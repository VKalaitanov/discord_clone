window.DEBUG_SPEECH = true;

let localStream = null;
let localVideoTrack = null;
let ws = null;
let clientId = null;
let videoEnabled = false;

const peers = {};          // RTCPeerConnections
const peerElements = {};   // DOM карточки участников
const speakingLoops = {};  // Мониторинг речи

document.addEventListener("DOMContentLoaded", () => {
    const joinBtn  = document.getElementById("join");
    const leaveBtn = document.getElementById("leave");
    const roomInput = document.getElementById("room");
    const peersList = document.getElementById("peersList");
    const videoBtn = document.getElementById("video-toggle");

    joinBtn.addEventListener("click", () => joinRoom(roomInput, peersList, joinBtn, leaveBtn));
    leaveBtn.addEventListener("click", () => leaveRoom(joinBtn, leaveBtn, roomInput));

    videoBtn.addEventListener("click", async ()=>{
        if(!localStream) return;
        videoEnabled = !videoEnabled;
        if(videoEnabled){
            const newStream = await navigator.mediaDevices.getUserMedia({video:true});
            localVideoTrack = newStream.getVideoTracks()[0];
            localStream.addTrack(localVideoTrack);
            Object.values(peers).forEach(pc=>{
                pc.addTrack(localVideoTrack, localStream);
                sendOffer(pc.peerId);
            });
            videoBtn.textContent = "Выключить видео";
        } else {
            if(localVideoTrack){
                localVideoTrack.stop();
                localStream.removeTrack(localVideoTrack);
            }
            videoBtn.textContent = "Включить видео";
        }
    });
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
async function startLocalStream(){
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation:true, noiseSuppression:true },
            video: false // по умолчанию только голос
        });
        return localStream;
    } catch(e) {
        console.error("Ошибка доступа к микрофону:", e);
        alert("Разрешите доступ к микрофону");
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
function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers:[{urls:"stun:stun.l.google.com:19302"}] });

    if(localStream){
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = e=>{
        if(e.candidate) ws?.send(JSON.stringify({type:"candidate", candidate:e.candidate, to:peerId, from:clientId}));
    };

    pc.ontrack = e => handleTrack(peerId, e);
    pc.peerId = peerId;

    return pc;
}

function handleTrack(peerId, event){
    const stream = event.streams[0];
    if(!document.getElementById("peer-"+peerId)){
        addPeerUI(peerId, document.getElementById("peersList"));
    }

    const audio = document.getElementById("audio-"+peerId);
    if(event.track.kind === "audio"){
        audio.srcObject = stream;
        audio.autoplay = true;
        monitorSpeaking(peerId, stream);
    }

    const video = document.getElementById("video-"+peerId);
    if(event.track.kind === "video" && !video){
        const v = document.createElement("video");
        v.id = "video-"+peerId;
        v.autoplay = true;
        v.playsInline = true;
        document.getElementById("peer-"+peerId).appendChild(v);
        v.srcObject = stream;
    }
}

// ======== UI ========
function addPeerUI(peerId, peersList, isLocal=false){
    if(peerElements[peerId]) return;
    const div = document.createElement("div");
    div.className="peer"; div.id="peer-"+peerId;
    div.innerHTML=`
        <audio id="audio-${peerId}" autoplay playsinline ${isLocal?"muted":""}></audio>
        <div class="info">
            <span class="peer-id">${isLocal?"Вы":peerId}</span>
            <span class="mic" id="mic-${peerId}">🎤</span>
            <div class="vu"><div class="fill" id="vu-${peerId}"></div></div>
        </div>
        ${isLocal?`<div class="controls">
            <button id="mute-${peerId}">Выключить микрофон</button>
        </div>`:""}
    `;
    peersList.appendChild(div);
    peerElements[peerId]=div;

    if(isLocal){
        const muteBtn=document.getElementById("mute-"+peerId);
        let isMuted=false;
        muteBtn.addEventListener("click", ()=>{
            if(!localStream) return;
            isMuted = !isMuted;
            localStream.getAudioTracks()[0].enabled = !isMuted;
            muteBtn.textContent = isMuted?"Включить микрофон":"Выключить микрофон";
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
            clientId = msg.id;
            addPeerUI(clientId, peersList, true);
            const localAudio = document.getElementById("audio-"+clientId);
            if(localAudio) localAudio.srcObject = localStream;
            monitorSpeaking(clientId, localStream);

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
    if(localStream) { localStream.getTracks().forEach(t=>t.stop()); localStream=null; localVideoTrack=null; }

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
