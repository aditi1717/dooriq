// PM2 topology, sized for ~4k concurrent users on a 2 vCPU / 8 GB box.
//
// Memory budget (worst case, before PM2 recycles anything):
//   2 x api        @ 700M = 1400M
//   1 x socket     @ 1200M = 1200M
//   6 x worker     @ 400M  = 2400M
//                          -------
//                            5.0G   of 7.6G usable, leaving room for
//                                   redis, nginx and page cache.
//
// Every ceiling below is a RECYCLE threshold, not an expected footprint. The
// API workers currently sit around 230M and the workers around 90M.
const num = (name, fallback) => Number(process.env[name] || fallback);

const base = {
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    // Restart storms were previously invisible: a process that crashed on
    // startup would spin forever at PM2's default 0ms delay. Back off, and
    // give up after 15 tries so a broken deploy is obvious in `pm2 ls`
    // instead of silently pegging a core.
    restart_delay: 2000,
    exp_backoff_restart_delay: 200,
    max_restarts: 15,
    // Treat a process that survives 60s as healthy, so the restart counter
    // reflects real crash loops rather than lifetime restarts.
    min_uptime: '60s',
    kill_timeout: 12000,
    listen_timeout: 15000,
    merge_logs: true,
    time: true,
    env: { NODE_ENV: 'production' },
};

const worker = (name, script) => ({
    ...base,
    name,
    script,
    max_memory_restart: process.env.PM2_WORKER_MEMORY || '400M',
});

module.exports = {
    apps: [
        {
            ...base,
            name: 'dooriq-api',
            script: './server.js',
            exec_mode: 'cluster',
            // 'max' on a 2-core box gives 2 API workers, which is right — but
            // it is stated explicitly so that moving to a bigger box is a
            // deliberate decision rather than an accidental fan-out that
            // multiplies the Mongo pool (maxPoolSize x instances) past the
            // Atlas connection cap.
            instances: num('PM2_API_INSTANCES', 2),
            max_memory_restart: process.env.PM2_API_MEMORY || '700M',
            // Let V8 use most of the ceiling before it starts fighting the GC,
            // and keep the libuv pool wide enough that DNS lookups and crypto
            // do not queue behind each other under load.
            node_args: '--max-old-space-size=640',
            env: { ...base.env, PORT: num('PORT', 5000), UV_THREADPOOL_SIZE: 16 },
        },
        {
            ...base,
            name: 'dooriq-socket',
            script: './socket-server.js',

            // Stays at ONE instance on purpose. The restaurant web client
            // connects with transports:['polling'] only, and long-polling
            // requires every request from a client to reach the same process.
            // Scaling this past 1 without sticky sessions in nginx silently
            // breaks those clients. See the transports comment in
            // src/config/socket.js for the full picture and the exit path.
            instances: num('PM2_SOCKET_INSTANCES', 1),

            // This is the important line.
            //
            // The old ceiling was 500M. A socket process holding a few
            // thousand connections exceeds that on connection state alone, so
            // PM2 would kill it — dropping every live order feed and location
            // stream at once, then killing the replacement as clients piled
            // back on. That is a crash loop that looks like "the platform died
            // under load" while CPU sits near idle, which matches exactly what
            // was observed. 1.2G gives real headroom.
            max_memory_restart: process.env.PM2_SOCKET_MEMORY || '1200M',
            node_args: '--max-old-space-size=1100',
            env: { ...base.env, SOCKET_PORT: num('SOCKET_PORT', 5001), UV_THREADPOOL_SIZE: 16 },
        },

        worker('dooriq-worker-otp', './src/queues/workers/otp.worker.js'),
        worker('dooriq-worker-notification', './src/queues/workers/notification.worker.js'),
        worker('dooriq-worker-order', './src/queues/workers/order.worker.js'),
        worker('dooriq-worker-tracking', './src/queues/workers/tracking.worker.js'),
        worker('dooriq-worker-payment', './src/queues/workers/payment.worker.js'),
        worker('dooriq-worker-maintenance', './src/queues/workers/maintenance.worker.js'),
    ],
};
