// One fork-mode instance, per docs/adr/0001. Do not raise `instances`.
module.exports = {
  apps: [{
    name: 'temperature-api',
    script: './dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_memory_restart: '500M',
    autorestart: true,
    // pm2 stops with SIGINT and kills this long after, 10 s as Docker does; the backend stops itself within 8 (src/shutdown.ts).
    kill_timeout: 10000,
    watch: false,
    time: true
  }]
};
