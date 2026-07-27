# Room-of-devs TTS daemon — container smoke / instance-isolation harness.
# No live Gemini/ElevenLabs keys required; ffplay uses a null audio driver.
FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      ffmpeg \
      tmux \
      ca-certificates \
      python3 \
      build-essential \
      libusb-1.0-0-dev \
      pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.7.1 --activate

# Null audio for ffplay inside CI/containers (issue #66).
ENV SDL_AUDIODRIVER=dummy
ENV ELECTRON_RUN_AS_NODE=1

WORKDIR /app

# Copy workspace manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tts-server/package.json tts-server/pnpm-lock.yaml* ./tts-server/
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/room-client/package.json ./packages/room-client/
COPY packages/ui/package.json ./packages/ui/
COPY packages/mobile/package.json ./packages/mobile/
COPY panel/package.json ./panel/

RUN pnpm install --frozen-lockfile

COPY . .

# protocol is a symlink in the repo — ensure the staged tree resolves.
RUN if [ -L tts-server/src/protocol ]; then \
      rm tts-server/src/protocol && \
      mkdir -p tts-server/src/protocol && \
      cp -a packages/protocol/src/. tts-server/src/protocol/; \
    fi \
 && mkdir -p tts-server/mobile-dist \
 && if [ -d packages/mobile/dist ]; then cp -a packages/mobile/dist/. tts-server/mobile-dist/; fi

ENV TTS_DIR=/tmp/tts-test
# No API keys in the image — Gemini/ElevenLabs skip by design.
ENV ELEVENLABS_API_KEY=
ENV GEMINI_API_KEY=

WORKDIR /app/tts-server
EXPOSE 4785 4780

CMD ["pnpm", "exec", "tsx", "src/index.ts"]
