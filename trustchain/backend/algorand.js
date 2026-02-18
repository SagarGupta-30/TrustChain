const algosdk = require("algosdk");
const crypto = require("crypto");

let algodClient;
let indexerClient;
const DEFAULT_ALGOD_SERVER = "https://testnet-api.algonode.cloud";
const DEFAULT_INDEXER_SERVER = "https://testnet-idx.algonode.cloud";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required in environment variables`);
  }
  return value;
}

function getOptionalEnv(name, fallbackValue) {
  const value = process.env[name];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallbackValue;
}

function toAddressString(address) {
  if (typeof address === "string") {
    return address;
  }

  if (address && typeof address.toString === "function") {
    return address.toString();
  }

  throw new Error("Unable to resolve Algorand address");
}

function getAlgodClient() {
  if (!algodClient) {
    const server = getOptionalEnv("ALGOD_SERVER", DEFAULT_ALGOD_SERVER);
    const token = process.env.ALGOD_TOKEN || "";
    const port = process.env.ALGOD_PORT || "";
    algodClient = new algosdk.Algodv2(token, server, port);
  }

  return algodClient;
}

function getIndexerClient() {
  if (!indexerClient) {
    const server = getOptionalEnv("INDEXER_SERVER", DEFAULT_INDEXER_SERVER);
    const token = process.env.INDEXER_TOKEN || "";
    const port = process.env.INDEXER_PORT || "";
    indexerClient = new algosdk.Indexer(token, server, port);
  }

  return indexerClient;
}

function getIssuerAccount() {
  const mnemonic = process.env.ALGORAND_MNEMONIC;
  if (!mnemonic || !mnemonic.trim()) {
    throw new Error(
      "ALGORAND_MNEMONIC is required in backend/.env to issue proofs and load issuer history"
    );
  }

  return algosdk.mnemonicToSecretKey(mnemonic);
}

function getIssuerAddress() {
  return toAddressString(getIssuerAccount().addr);
}

function computeSHA256(fileBuffer) {
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}

function buildTrustChainNote(hash, metadata = {}) {
  const notePayload = {
    app: "TrustChain",
    hash,
    ...metadata,
    createdAt: new Date().toISOString(),
  };

  return new Uint8Array(Buffer.from(JSON.stringify(notePayload), "utf8"));
}

function decodeNote(transaction) {
  if (!transaction || !transaction.note) {
    return null;
  }

  try {
    return Buffer.from(transaction.note, "base64").toString("utf8");
  } catch (_error) {
    return null;
  }
}

function parseNotePayload(transaction) {
  const noteText = decodeNote(transaction);
  if (!noteText) {
    return null;
  }

  try {
    return JSON.parse(noteText);
  } catch (_error) {
    return null;
  }
}

function parseHashFromTransaction(transaction) {
  const parsed = parseNotePayload(transaction);
  if (parsed && typeof parsed.hash === "string") {
    return parsed.hash.toLowerCase();
  }

  const noteText = decodeNote(transaction);
  if (!noteText) {
    return null;
  }

  const hashMatch = noteText.match(/[a-f0-9]{64}/i);
  return hashMatch ? hashMatch[0].toLowerCase() : null;
}

async function waitForConfirmation(txId) {
  return algosdk.waitForConfirmation(getAlgodClient(), txId, 10);
}

async function createProofTransaction(hash, fileMetadata = {}) {
  const algod = getAlgodClient();
  const issuer = getIssuerAccount();
  const sender = toAddressString(issuer.addr);

  const suggestedParams = await algod.getTransactionParams().do();
  const note = buildTrustChainNote(hash, {
    type: "proof",
    fileName: fileMetadata.fileName,
    mimeType: fileMetadata.mimeType,
    fileSize: fileMetadata.fileSize,
    referenceLabel: fileMetadata.referenceLabel || null,
  });

  const transaction = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: sender,
    to: sender,
    amount: 0,
    suggestedParams,
    note,
  });

  const signedTransaction = transaction.signTxn(issuer.sk);
  const sendResponse = await algod.sendRawTransaction(signedTransaction).do();
  const txId = sendResponse.txId;
  const confirmation = await waitForConfirmation(txId);

  return {
    txId,
    confirmedRound: confirmation["confirmed-round"],
    noteHash: hash,
  };
}

async function mintProofAsset(hash, fileMetadata = {}) {
  const algod = getAlgodClient();
  const issuer = getIssuerAccount();
  const address = toAddressString(issuer.addr);

  const suggestedParams = await algod.getTransactionParams().do();
  const note = buildTrustChainNote(hash, {
    type: "asa",
    fileName: fileMetadata.fileName,
    referenceLabel: fileMetadata.referenceLabel || null,
  });

  const dayStamp = new Date().toISOString().slice(0, 10);
  const assetName = `TrustChain Proof ${dayStamp}`;

  const transaction = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    from: address,
    suggestedParams,
    total: 1,
    decimals: 0,
    defaultFrozen: false,
    unitName: "TRUSTPRF",
    assetName,
    assetURL: `https://trustchain.app/proof/${hash.slice(0, 32)}`,
    manager: address,
    reserve: address,
    freeze: address,
    clawback: address,
    note,
  });

  const signedTransaction = transaction.signTxn(issuer.sk);
  const sendResponse = await algod.sendRawTransaction(signedTransaction).do();
  const txId = sendResponse.txId;
  const confirmation = await waitForConfirmation(txId);

  return {
    txId,
    assetId: confirmation["asset-index"],
    confirmedRound: confirmation["confirmed-round"],
  };
}

async function fetchTransactionById(transactionId) {
  const indexer = getIndexerClient();
  const response = await indexer.lookupTransactionByID(transactionId).do();
  return response.transaction || null;
}

async function fetchIssuerTransactionHistory(limit = 20) {
  const indexer = getIndexerClient();
  const address = getIssuerAddress();

  const response = await indexer
    .searchForTransactions()
    .address(address)
    .limit(limit)
    .do();

  const transactions = response.transactions || [];

  return transactions.map((transaction) => {
    const parsedNote = parseNotePayload(transaction);

    return {
      id: transaction.id,
      type: transaction["tx-type"],
      roundTime: transaction["round-time"] || null,
      confirmedRound: transaction["confirmed-round"] || null,
      hash: parsedNote && parsedNote.hash ? parsedNote.hash : null,
      noteType: parsedNote && parsedNote.type ? parsedNote.type : null,
      note: parsedNote || null,
      assetId: transaction["created-asset-index"] || null,
    };
  });
}

async function fetchIssuerAccountState() {
  const algod = getAlgodClient();
  const address = getIssuerAddress();
  const account = await algod.accountInformation(address).do();

  const amount = Number(account.amount || 0);
  const minBalance = Number(account["min-balance"] || account.minBalance || 0);
  const spendable = Math.max(amount - minBalance, 0);

  return {
    address,
    amount,
    minBalance,
    spendable,
  };
}

module.exports = {
  computeSHA256,
  createProofTransaction,
  fetchIssuerAccountState,
  fetchIssuerTransactionHistory,
  fetchTransactionById,
  getIssuerAddress,
  mintProofAsset,
  parseHashFromTransaction,
};
