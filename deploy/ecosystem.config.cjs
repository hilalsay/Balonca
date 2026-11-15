// PM2 process file for the subtitle service. Copy next to server/ and run: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'balonca-api',
    script: 'server/index.mjs',
    env: {
      PORT: 8787,
      HOST: '127.0.0.1',          // only nginx talks to it
      TRUST_PROXY: '1',           // nginx sets X-Forwarded-For
      // yt-dlp: the one installed on this machine (on PATH) is used; set YTDLP_BIN only to override.
      RATE_PER_MINUTE: 30,
      // Translation with a local Ollama model (see README "Automatic translation").
      OLLAMA_URL: 'http://127.0.0.1:11434',
      OLLAMA_MODEL: 'gemma3:latest',
      // OLLAMA_HOST_HEADER: '127.0.0.1',   // only if your Ollama rejects other Host headers
    },
    max_memory_restart: '300M',
  }],
};
