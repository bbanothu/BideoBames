FROM python:3.12-slim
RUN pip install --no-cache-dir websockets
COPY relay_server.py .
EXPOSE 9080
CMD ["python", "relay_server.py"]
