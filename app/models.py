from sqlalchemy import Column, Integer, String
from .database import Base

class Room(Base):
    __tablename__ = "rooms"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    # messages = relationship("Message", back_populates="room")

# class Message(Base):
#     __tablename__ = "messages"
#     id = Column(Integer, primary_key=True, index=True)
#     room_id = Column(Integer, ForeignKey("rooms.id"))
#     content = Column(Text)
#     created_at = Column(DateTime, server_default=func.now())
#
#     room = relationship("Room", back_populates="messages")
