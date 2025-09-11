# from fastapi import FastAPI, WebSocket, WebSocketDisconnect
# from typing import List
#
# app = FastAPI()
#
# class ConnectionManager:
#     def __init__(self):
#         self.active: List[WebSocket] = []
#
#     async def connect(self, ws: WebSocket):
#         await ws.accept()
#         self.active.append(ws)
#
#     def disconnect(self, ws: WebSocket):
#         if ws in self.active:
#             self.active.remove(ws)
#
#     async def broadcast(self, message: str, sender: WebSocket):
#         for conn in self.active:
#             if conn != sender:
#                 await conn.send_text(message)
#
# manager = ConnectionManager()
#
# @app.websocket("/ws/{room_id}")
# async def websocket_endpoint(ws: WebSocket, room_id: str):
#     await manager.connect(ws)
#     try:
#         while True:
#             data = await ws.receive_text()
#             await manager.broadcast(data, ws)
#     except WebSocketDisconnect:
#         manager.disconnect(ws)
