# Используем легкий образ Python
FROM python:3.11-slim

WORKDIR /app

# Обновляем pip и устанавливаем зависимости
RUN pip install --upgrade pip
COPY requirements.txt .
RUN pip install -r requirements.txt

# Копируем весь проект
COPY . /app

# Открываем порт для FastAPI
EXPOSE 8000

# Запуск uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
