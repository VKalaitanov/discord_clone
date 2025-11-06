import uuid
from typing import Dict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from starlette.staticfiles import StaticFiles



contacts = {
    "Мама": {"phone": "+79612766626", "telegram_id": 123456789},
    "Папа": {"phone": "+79995554433", "telegram_id": 987654321},
}

app = FastAPI()

# Подключаем статику
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/js", StaticFiles(directory="js"), name="js")

# rooms_ws[room_id] = { client_id: websocket }
rooms_ws: Dict[str, Dict[str, WebSocket]] = {}


@app.get("/", response_class=HTMLResponse)
async def index():
    """Главная страница"""
    with open("frontend/index.html", "r", encoding="utf-8") as f:
        return f.read()


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    # contact = contacts.get(room_id)
    # if contact:
    #     text = f'{room_id}, зайди в голосовую комнату!'
    #     send_voice_call(contact, text)

    await websocket.accept()
    client_id = str(uuid.uuid4())
    room = rooms_ws.setdefault(room_id, {})
    room[client_id] = websocket

    print(f"[INFO] Client {client_id} connected to room {room_id}. Total participants: {len(room)}")

    # Отправляем новому клиенту его ID
    await websocket.send_json({"type": "id", "id": client_id})

    # Уведомляем остальных участников о новом подключении
    for peer_id, peer_ws in room.items():
        if peer_id != client_id:
            try:
                await peer_ws.send_json({"type": "new-peer", "id": client_id})
            except Exception as e:
                print(f"[WARN] Failed to notify {peer_id}: {e}")

    try:
        while True:
            data = await websocket.receive_json()
            to_id = data.get("to")
            from_id = data.get("from", client_id)

            if to_id:
                # Отправка конкретному получателю
                peer_ws = room.get(to_id)
                if peer_ws:
                    try:
                        await peer_ws.send_json(data)
                    except Exception as e:
                        print(f"[WARN] Failed to send message from {from_id} to {to_id}: {e}")
            else:
                # Если to нет, рассылаем всем кроме отправителя (broadcast)
                for peer_id, peer_ws in room.items():
                    if peer_id != client_id:
                        try:
                            await peer_ws.send_json(data)
                        except Exception as e:
                            print(f"[WARN] Failed to broadcast message from {from_id} to {peer_id}: {e}")

    except WebSocketDisconnect:
        print(f"[INFO] Client {client_id} disconnected from room {room_id}")
    except Exception as e:
        print(f"[ERROR] Exception in room {room_id} for client {client_id}: {e}")
    finally:
        # Удаляем клиента и уведомляем остальных
        if client_id in room:
            room.pop(client_id)
            print(f"[INFO] Client {client_id} removed from room {room_id}. Remaining participants: {len(room)}")
            for peer_ws in room.values():
                try:
                    await peer_ws.send_json({"type": "peer-left", "id": client_id})
                except Exception as e:
                    print(f"[WARN] Failed to notify peer about leaving {client_id}: {e}")

        if not room:
            rooms_ws.pop(room_id, None)
            print(f"[INFO] Room {room_id} is now empty and removed.")
