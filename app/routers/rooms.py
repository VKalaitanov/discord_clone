from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app import models, schemas, crud
from app.database import get_db

router = APIRouter(prefix="/rooms", tags=["rooms"])

@router.post("/", response_model=schemas.Room)
def create_room(room: schemas.RoomCreate, db: Session = Depends(get_db)):
    return crud.create_room(db, room)

@router.get("/", response_model=list[schemas.Room])
def list_rooms(db: Session = Depends(get_db)):
    return crud.get_rooms(db)
