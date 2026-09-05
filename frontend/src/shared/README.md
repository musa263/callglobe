# Shared Browser Foundation

`api.js` owns HTTP requests and cookie-session metadata helpers. Feature modules
consume it; it must not import feature screens or initialize calling. Its session
storage tests are colocated. Browser metadata is not proof of authorization;
the server validates the session on every protected operation.
