const app = require("../trustchain/backend/server");

module.exports = (req, res) => {
  // Normalize URL so backend routes work whether Vercel strips /api prefix or not.
  if (!req.url.startsWith("/api")) {
    req.url = `/api${req.url}`;
  }

  return app(req, res);
};
