from sqlalchemy.orm import Session
from . import models, schemas

def create_room(db: Session, room: schemas.RoomCreate):
    db_room = models.Room(name=room.name)
    db.add(db_room)
    db.commit()
    db.refresh(db_room)
    return db_room

def get_rooms(db: Session):
    return db.query(models.Room).all()

# def create_message(db: Session, room_id: int, content: str):
#     msg = models.Message(room_id=room_id, content=content)
#     db.add(msg)
#     db.commit()
#     db.refresh(msg)
#     return msg
#
# def get_messages(db: Session, room_id: int):
#     return db.query(models.Message).filter(models.Message.room_id == room_id).all()
