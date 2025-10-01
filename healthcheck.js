import http from 'http';

const options = {
    host: 'localhost',
    port: process.env.PORT || 3000,
    path: '/api/health/live',
    timeout: 2000,
    method: 'GET'
};

const healthCheck = http.request(options, (res) => {
    console.log(`HEALTHCHECK STATUS: ${res.statusCode}`);
    if (res.statusCode === 200) {
        process.exit(0);
    } else {
        process.exit(1);
    }
});

healthCheck.on('error', (err) => {
    console.error('HEALTHCHECK ERROR:', err.message);
    process.exit(1);
});

healthCheck.on('timeout', () => {
    console.error('HEALTHCHECK TIMEOUT');
    healthCheck.destroy();
    process.exit(1);
});

healthCheck.end();