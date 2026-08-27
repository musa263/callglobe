import http from 'node:http';

const port = Number(process.env.HEALTH_PORT || 8088);
const request = http.get({ hostname: '127.0.0.1', port, path: '/healthz', timeout: 3000 }, (response) => {
  response.resume();
  process.exit(response.statusCode === 200 ? 0 : 1);
});
request.on('timeout', () => request.destroy(new Error('Health check timed out.')));
request.on('error', () => process.exit(1));
