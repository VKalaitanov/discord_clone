SMS_AGENT_LOGIN = os.getenv("AGENT_LOGIN")
SMS_AGENT_PASS = os.getenv("AGENT_PASSWORD")
SMS_AGENT_API_URL = os.getenv("SMS_AGENT_API_URL")


def send_voice_call(phone: str, text: str):
    """Пример вызова API голосового звонка"""
    payload = {
        "login": SMS_AGENT_LOGIN,
        "pass": SMS_AGENT_PASS,
        "type": "voice_lo",
        "sender": 'di-di.ru',
        "text": text,
        "payload": [{"phone": phone}],
    }
    headers = {"Content-Type": "application/json; charset=utf-8"}
    response = requests.post(SMS_AGENT_API_URL, json=payload, headers=headers)
    print(response.json())
    return response.text