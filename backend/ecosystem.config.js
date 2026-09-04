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
    watch: false,
    time: true
  }]
};
