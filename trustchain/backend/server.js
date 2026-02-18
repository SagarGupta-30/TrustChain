require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const routes = require("./routes");

const app = express();
const port = Number(process.env.PORT || 4000);

const configuredOrigins = (process.env.ALLOWED_ORIGIN || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowLocalOrigins = process.env.ALLOW_LOCAL_ORIGINS !== "false";

function isPrivateIpv4(hostname) {
  const match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  );
  if (!match) {
    return false;
  }

  const a = Number(match[1]);
  const b = Number(match[2]);

  if (a === 10 || a === 127) {
    return true;
  }

  if (a === 192 && b === 168) {
    return true;
  }

  return a === 172 && b >= 16 && b <= 31;
}

function isLocalOrigin(origin) {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname;

    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
      return true;
    }

    return isPrivateIpv4(host);
  } catch (_error) {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      // Browsers use literal "null" origin for file:// pages.
      if (origin === "null") {
        callback(null, true);
        return;
      }

      if (
        configuredOrigins.includes("*") ||
        configuredOrigins.includes(origin)
      ) {
        callback(null, true);
        return;
      }

      if (allowLocalOrigins && isLocalOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"));
    },
  })
);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("tiny"));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "trustchain-backend",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", routes);

app.use((err, _req, res, _next) => {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Unexpected server error";

  if (statusCode >= 500) {
    console.error("Unhandled server error:", err);
  }

  res.status(statusCode).json({
    error: message,
  });
});

module.exports = app;

if (require.main === module) {
  app.listen(port, () => {
    console.log(`TrustChain backend is running on port ${port}`);
  });
}
