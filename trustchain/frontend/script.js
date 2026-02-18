const API_STORAGE_KEY = "trustchain_api_base";

let API_BASE = "";
let apiBootstrapPromise = null;

function normalizeApiBase(value) {
  const cleaned = value.trim().replace(/\/+$/, "");
  if (!cleaned) {
    return "";
  }

  if (cleaned.endsWith("/api")) {
    return cleaned;
  }

  if (cleaned === "/api") {
    return cleaned;
  }

  return `${cleaned}/api`;
}

function resolveApiBase() {
  const query = new URLSearchParams(window.location.search);
  const queryApi = query.get("api");

  if (queryApi) {
    const normalized = normalizeApiBase(queryApi);
    localStorage.setItem(API_STORAGE_KEY, normalized);
    query.delete("api");
    const queryString = query.toString();
    const cleanedUrl = queryString
      ? `${window.location.pathname}?${queryString}`
      : window.location.pathname;
    window.history.replaceState({}, "", cleanedUrl);
  }

  const saved = localStorage.getItem(API_STORAGE_KEY);
  if (saved) {
    return normalizeApiBase(saved);
  }

  if (window.location.protocol === "file:") {
    return "http://localhost:4000/api";
  }

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:4000/api";
  }

  return "/api";
}

function isPrivateIpv4Host(hostname) {
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

function getFallbackCandidates(current) {
  const candidates = [];
  const currentHost = window.location.hostname;
  const currentProtocol = window.location.protocol === "https:" ? "https" : "http";
  const isLikelyLocalHost =
    currentHost === "localhost" ||
    currentHost === "127.0.0.1" ||
    currentHost.endsWith(".local") ||
    isPrivateIpv4Host(currentHost);

  if (isLikelyLocalHost) {
    candidates.push(`${currentProtocol}://${currentHost}:4000/api`);
    candidates.push("http://localhost:4000/api");
    candidates.push("http://127.0.0.1:4000/api");
  }

  if (currentHost) {
    candidates.push("/api");
  }

  if (current) {
    candidates.unshift(current);
  }

  return [...new Set(candidates.map((item) => normalizeApiBase(item)).filter(Boolean))];
}

function updateApiBadge() {
  const badge = document.getElementById("apiEndpointBadge");
  if (badge) {
    badge.textContent = API_BASE;
  }
}

async function probeApiBase(base) {
  try {
    const response = await fetch(`${base}/health`, { method: "GET" });
    return response.ok;
  } catch (_error) {
    return false;
  }
}

async function bootstrapApiBase() {
  const initial = resolveApiBase();
  const candidates = getFallbackCandidates(initial);

  for (const candidate of candidates) {
    // Keep probing cheap and deterministic: first responsive candidate wins.
    // This prevents stale localStorage values from breaking the app.
    // eslint-disable-next-line no-await-in-loop
    const ok = await probeApiBase(candidate);
    if (ok) {
      API_BASE = candidate;
      localStorage.setItem(API_STORAGE_KEY, candidate);
      updateApiBadge();
      return true;
    }
  }

  API_BASE = initial;
  updateApiBadge();
  return false;
}

function buildApiUrl(pathname) {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${API_BASE}${path}`;
}

async function requestApi(pathname, options = {}) {
  if (!apiBootstrapPromise) {
    apiBootstrapPromise = bootstrapApiBase();
  }
  await apiBootstrapPromise;

  const url = buildApiUrl(pathname);
  let response;

  try {
    response = await fetch(url, options);
  } catch (_error) {
    throw new Error(
      `Cannot reach backend at ${API_BASE}. Start backend or update API Settings.`
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { message: await response.text() };

  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
  }

  return payload;
}

function setStatus(element, message, type) {
  element.textContent = message;
  element.classList.remove("success", "error");

  if (type === "success" || type === "error") {
    element.classList.add(type);
  }
}

function shorten(value, size = 14) {
  if (!value || value.length <= size * 2) {
    return value || "-";
  }

  return `${value.slice(0, size)}...${value.slice(-size)}`;
}

function formatDate(dateString) {
  if (!dateString) {
    return "-";
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

function formatAlgosFromMicroAlgos(microAlgos) {
  if (typeof microAlgos !== "number" || Number.isNaN(microAlgos)) {
    return "-";
  }

  return `${(microAlgos / 1_000_000).toFixed(3)} ALGO`;
}

function wireApiSettingsModal() {
  const openButton = document.getElementById("apiConfigButton");
  const modal = document.getElementById("apiConfigModal");
  const closeButton = document.getElementById("closeApiModal");
  const form = document.getElementById("apiConfigForm");
  const input = document.getElementById("apiBaseInput");

  updateApiBadge();

  if (!openButton || !modal || !closeButton || !form || !input) {
    return;
  }

  input.value = API_BASE;

  openButton.addEventListener("click", () => {
    modal.classList.add("open");
    input.focus();
  });

  closeButton.addEventListener("click", () => {
    modal.classList.remove("open");
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.classList.remove("open");
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextBase = normalizeApiBase(input.value);

    if (!nextBase) {
      alert("Enter a valid URL for your backend API endpoint.");
      return;
    }

    localStorage.setItem(API_STORAGE_KEY, nextBase);
    window.location.reload();
  });
}

async function initHomePage() {
  const networkStatus = document.getElementById("networkStatus");
  if (!networkStatus) {
    return;
  }

  try {
    const health = await requestApi("/health");
    const issuerStatus = await requestApi("/issuer/status");

    if (issuerStatus.canIssue) {
      networkStatus.textContent = `Connected to ${health.service}. Issuer is funded and ready.`;
      return;
    }

    networkStatus.textContent = `Connected to ${health.service}. Issuer needs funding (${formatAlgosFromMicroAlgos(
      issuerStatus.requiredForIssue
    )} minimum).`;
  } catch (error) {
    networkStatus.textContent = `Backend unavailable: ${error.message}`;
  }
}

function initIssuePage() {
  const form = document.getElementById("issueForm");
  if (!form) {
    return;
  }

  const fileInput = document.getElementById("issueFile");
  const submitButton = document.getElementById("issueSubmit");
  const status = document.getElementById("issueStatus");
  const resultCard = document.getElementById("issueResult");
  const emptyState = document.getElementById("issueEmpty");

  const hashNode = document.getElementById("issuedHash");
  const txNode = document.getElementById("issuedTxId");
  const assetNode = document.getElementById("issuedAssetId");

  async function ensureIssuerReady() {
    const issuerStatus = await requestApi("/issuer/status");

    if (issuerStatus.canIssue) {
      return true;
    }

    setStatus(
      status,
      `Fund issuer wallet ${issuerStatus.address || ""} with at least ${formatAlgosFromMicroAlgos(
        issuerStatus.requiredForIssue
      )}. Faucet: ${issuerStatus.fundingUrl || "https://lora.algokit.io/testnet/fund"}`,
      "error"
    );
    return false;
  }

  ensureIssuerReady().catch((error) => {
    setStatus(status, `Issuer check failed: ${error.message}`, "error");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const file = fileInput.files[0];
    if (!file) {
      setStatus(status, "Please choose a file before issuing proof.", "error");
      return;
    }

    submitButton.disabled = true;
    setStatus(status, "Submitting transaction and minting ASA. Please wait...", "");

    try {
      const ready = await ensureIssuerReady();
      if (!ready) {
        submitButton.disabled = false;
        return;
      }
    } catch (error) {
      setStatus(status, error.message, "error");
      submitButton.disabled = false;
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    const labelValue = document.getElementById("issueLabel").value.trim();
    if (labelValue) {
      formData.append("label", labelValue);
    }

    try {
      const response = await requestApi("/proofs/issue", {
        method: "POST",
        body: formData,
      });

      const proof = response.proof;
      hashNode.textContent = proof.hash;
      txNode.textContent = proof.transactionId;
      assetNode.textContent = String(proof.assetId);

      emptyState.classList.add("hidden");
      resultCard.classList.remove("hidden");

      setStatus(status, "Proof issued and confirmed on Algorand TestNet.", "success");
    } catch (error) {
      setStatus(status, error.message, "error");
    } finally {
      submitButton.disabled = false;
    }
  });
}

function initVerifyPage() {
  const form = document.getElementById("verifyForm");
  if (!form) {
    return;
  }

  const fileInput = document.getElementById("verifyFile");
  const transactionInput = document.getElementById("transactionId");
  const submitButton = document.getElementById("verifySubmit");
  const status = document.getElementById("verifyStatus");

  const result = document.getElementById("verifyResult");
  const empty = document.getElementById("verifyEmpty");

  const headline = document.getElementById("verifyHeadline");
  const uploadedHash = document.getElementById("verifyUploadedHash");
  const onChainHash = document.getElementById("verifyOnChainHash");
  const txIdNode = document.getElementById("verifyTxId");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const file = fileInput.files[0];
    const transactionId = transactionInput.value.trim().toUpperCase();

    if (!file || !transactionId) {
      setStatus(status, "Upload a file and provide a transaction ID.", "error");
      return;
    }

    submitButton.disabled = true;
    setStatus(status, "Running on-chain verification...", "");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("transactionId", transactionId);

    try {
      const verification = await requestApi("/proofs/verify", {
        method: "POST",
        body: formData,
      });

      result.classList.remove("hidden", "success", "error");
      empty.classList.add("hidden");

      if (verification.verified) {
        result.classList.add("success");
        headline.textContent = "VERIFIED";
        setStatus(status, "Document is authentic and matches blockchain record.", "success");
      } else {
        result.classList.add("error");
        headline.textContent = "INVALID";
        setStatus(status, "Document hash does not match the blockchain record.", "error");
      }

      uploadedHash.textContent = verification.uploadedHash;
      onChainHash.textContent = verification.onChainHash;
      txIdNode.textContent = verification.transactionId;
    } catch (error) {
      setStatus(status, error.message, "error");
      result.classList.add("hidden");
      empty.classList.remove("hidden");
    } finally {
      submitButton.disabled = false;
    }
  });
}

function renderProofsTable(proofs) {
  const table = document.getElementById("proofsTableBody");
  const empty = document.getElementById("proofsEmpty");
  if (!table || !empty) {
    return;
  }

  table.innerHTML = "";
  if (!proofs.length) {
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  proofs.forEach((proof) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${proof.fileName || "-"}</td>
      <td><code>${shorten(proof.hash, 10)}</code></td>
      <td><code>${shorten(proof.transactionId, 10)}</code></td>
      <td>${proof.assetId || "-"}</td>
      <td>${formatDate(proof.issuedAt)}</td>
    `;
    table.appendChild(row);
  });
}

function renderHistoryTable(history) {
  const table = document.getElementById("historyTableBody");
  const empty = document.getElementById("historyEmpty");
  if (!table || !empty) {
    return;
  }

  table.innerHTML = "";
  if (!history.length) {
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  history.forEach((transaction) => {
    const row = document.createElement("tr");
    const hash = transaction.hash ? shorten(transaction.hash, 10) : "-";

    row.innerHTML = `
      <td><code>${shorten(transaction.id, 10)}</code></td>
      <td><span class="badge">${transaction.noteType || transaction.type || "tx"}</span></td>
      <td><code>${hash}</code></td>
      <td>${transaction.assetId || "-"}</td>
      <td>${transaction.confirmedRound || "-"}</td>
    `;

    table.appendChild(row);
  });
}

async function initDashboardPage() {
  const refreshButton = document.getElementById("refreshDashboard");
  const proofsCountNode = document.getElementById("statProofCount");
  const latestTxNode = document.getElementById("statLatestTx");
  const issuerNode = document.getElementById("statIssuer");

  if (!proofsCountNode || !latestTxNode || !issuerNode) {
    return;
  }

  async function loadDashboard() {
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = "Refreshing...";
    }

    try {
      const [proofResponse, historyResponse] = await Promise.all([
        requestApi("/proofs"),
        requestApi("/transactions/history"),
      ]);

      const proofs = proofResponse.proofs || [];
      const history = historyResponse.transactions || [];

      proofsCountNode.textContent = String(proofs.length);
      latestTxNode.textContent = proofs[0] ? shorten(proofs[0].transactionId, 10) : "-";
      issuerNode.textContent = historyResponse.issuer || "-";

      renderProofsTable(proofs);
      renderHistoryTable(history);
    } catch (error) {
      proofsCountNode.textContent = "Error";
      latestTxNode.textContent = "-";
      issuerNode.textContent = error.message;
      renderProofsTable([]);
      renderHistoryTable([]);
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh";
      }
    }
  }

  if (refreshButton) {
    refreshButton.addEventListener("click", loadDashboard);
  }

  await loadDashboard();
}

document.addEventListener("DOMContentLoaded", async () => {
  API_BASE = resolveApiBase();
  wireApiSettingsModal();
  if (!apiBootstrapPromise) {
    apiBootstrapPromise = bootstrapApiBase();
  }
  await apiBootstrapPromise;

  const page = document.body.dataset.page;

  if (page === "home") {
    await initHomePage();
    return;
  }

  if (page === "issue") {
    initIssuePage();
    return;
  }

  if (page === "verify") {
    initVerifyPage();
    return;
  }

  if (page === "dashboard") {
    await initDashboardPage();
  }
});
