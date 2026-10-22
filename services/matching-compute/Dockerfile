# Build from the repository root so the image can carry the project licence:
#   docker build -f services/matching-compute/Dockerfile .
FROM python:3.12-slim
WORKDIR /app
COPY services/matching-compute/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/matching-compute/compute.py .
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/doc/urtube/
USER 65534:65534
ENV OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
CMD ["python", "compute.py"]
