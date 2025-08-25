import uuid
from typing import Dict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from starlette.staticfiles import StaticFiles

app = FastAPI()
# Подключаем статику
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/js", StaticFiles(directory="js"), name="js")
# rooms[room_id] = { client_id: websocket }
rooms: Dict[str, Dict[str, WebSocket]] = {}


@app.get("/", response_class=HTMLResponse)
async def index():
    with open("frontend/index.html", "r", encoding="utf-8") as f:
        return f.read()


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()
    client_id = str(uuid.uuid4())
    room = rooms.setdefault(room_id, {})
    room[client_id] = websocket

    # отправляем новому клиенту его ID
    await websocket.send_json({"type": "id", "id": client_id})

    # уведомляем всех остальных о новом участнике
    for peer_id, peer_ws in room.items():
        if peer_id != client_id:
            await peer_ws.send_json({"type": "new-peer", "id": client_id})

    try:
        while True:
            data = await websocket.receive_json()
            to_id = data.get("to")
            if to_id:
                peer_ws = room.get(to_id)
                if peer_ws:
                    await peer_ws.send_json(data)
    except WebSocketDisconnect:
        pass
    finally:
        # удалить клиента из комнаты
        if client_id in room:
            room.pop(client_id)
            # уведомляем всех, что участник вышел
            for peer_ws in room.values():
                await peer_ws.send_json({"type": "peer-left", "id": client_id})
        if not room:
            rooms.pop(room_id, None)
