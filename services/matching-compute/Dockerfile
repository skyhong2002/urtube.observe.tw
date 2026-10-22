# Build from the repository root so the image can carry the project licence:
#   docker build -f services/matching-compute/Dockerfile .
# Pinned by digest; see SECURITY.md for the update procedure.
FROM python:3.12-slim@sha256:cb33f7f771ecec2ef1225cf39b159591a040391bd73e4c01f00fdfc4c47611d2
WORKDIR /app
COPY services/matching-compute/requirements.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.txt
COPY services/matching-compute/compute.py .
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/doc/urtube/
USER 65534:65534
ENV OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
CMD ["python", "compute.py"]
