const express = require("express");
const multer = require("multer");

const {
  computeSHA256,
  createProofTransaction,
  fetchIssuerAccountState,
  fetchIssuerTransactionHistory,
  fetchTransactionById,
  getIssuerAddress,
  mintProofAsset,
  parseHashFromTransaction,
} = require("./algorand");

const router = express.Router();

const maxFileSizeMb = Number(process.env.MAX_FILE_SIZE_MB || 10);
const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;
const issueMinRecommendedMicroAlgos = Number(
  process.env.ISSUE_MIN_RECOMMENDED_MICROALGOS || 350000
);
const testnetFundingUrl = "https://lora.algokit.io/testnet/fund";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxFileSizeBytes,
  },
});

function isMissingMnemonicError(error) {
  return (
    error &&
    typeof error.message === "string" &&
    error.message.includes("ALGORAND_MNEMONIC")
  );
}

function isInsufficientFundsError(error) {
  return (
    error &&
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("overspend")
  );
}

function buildIssuerStatus(accountState) {
  const canIssue = accountState.amount >= issueMinRecommendedMicroAlgos;

  return {
    ...accountState,
    canIssue,
    requiredForIssue: issueMinRecommendedMicroAlgos,
    fundingUrl: testnetFundingUrl,
  };
}

function uploadSingleFile(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res
          .status(413)
          .json({ error: `File exceeds the ${maxFileSizeMb}MB size limit` });
        return;
      }

      res.status(400).json({ error: error.message });
      return;
    }

    next(error);
  });
}

function deriveProofsFromTransactions(transactions) {
  const assetByHash = new Map();

  for (const transaction of transactions) {
    if (transaction.noteType === "asa" && transaction.hash && transaction.assetId) {
      assetByHash.set(transaction.hash, transaction.assetId);
    }
  }

  return transactions
    .filter((transaction) => transaction.noteType === "proof" && transaction.hash)
    .map((transaction) => {
      const note = transaction.note || {};

      return {
        id: transaction.id,
        fileName: note.fileName || "Untitled file",
        referenceLabel: note.referenceLabel || null,
        mimeType: note.mimeType || null,
        fileSize: note.fileSize || null,
        hash: transaction.hash,
        transactionId: transaction.id,
        transactionRound: transaction.confirmedRound,
        assetId: assetByHash.get(transaction.hash) || null,
        issuedAt: transaction.roundTime
          ? new Date(transaction.roundTime * 1000).toISOString()
          : null,
      };
    })
    .sort((a, b) => (b.transactionRound || 0) - (a.transactionRound || 0));
}

router.get("/issuer", async (_req, res, next) => {
  try {
    const address = getIssuerAddress();
    res.json({ address });
  } catch (error) {
    if (isMissingMnemonicError(error)) {
      res.json({
        address: null,
        configurationError: error.message,
      });
      return;
    }

    next(error);
  }
});

router.get("/issuer/status", async (_req, res, next) => {
  try {
    const accountState = await fetchIssuerAccountState();
    res.json(buildIssuerStatus(accountState));
  } catch (error) {
    if (isMissingMnemonicError(error)) {
      res.json({
        address: null,
        amount: 0,
        minBalance: 0,
        spendable: 0,
        canIssue: false,
        requiredForIssue: issueMinRecommendedMicroAlgos,
        fundingUrl: testnetFundingUrl,
        configurationError: error.message,
      });
      return;
    }

    next(error);
  }
});

router.post("/proofs/issue", uploadSingleFile, async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer || !req.file.originalname) {
      res.status(400).json({ error: "A valid file upload is required" });
      return;
    }

    if (!process.env.ALGORAND_MNEMONIC || !process.env.ALGORAND_MNEMONIC.trim()) {
      res.status(400).json({
        error:
          "ALGORAND_MNEMONIC is missing in backend/.env. Add a funded TestNet mnemonic and restart the backend.",
      });
      return;
    }

    const issuerState = await fetchIssuerAccountState();
    if (issuerState.amount < issueMinRecommendedMicroAlgos) {
      res.status(400).json({
        error:
          "Issuer wallet has insufficient TestNet ALGO balance to issue proof transactions.",
        issuer: issuerState.address,
        amount: issuerState.amount,
        requiredForIssue: issueMinRecommendedMicroAlgos,
        fundingUrl: testnetFundingUrl,
      });
      return;
    }

    const referenceLabel = (req.body.label || "").trim() || null;
    const hash = computeSHA256(req.file.buffer);

    const proofTransaction = await createProofTransaction(hash, {
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      referenceLabel,
    });

    const assetTransaction = await mintProofAsset(hash, {
      fileName: req.file.originalname,
      referenceLabel,
    });

    const newProof = {
      id: proofTransaction.txId,
      fileName: req.file.originalname,
      referenceLabel,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      hash,
      transactionId: proofTransaction.txId,
      transactionRound: proofTransaction.confirmedRound,
      assetId: assetTransaction.assetId,
      assetTransactionId: assetTransaction.txId,
      issuedAt: new Date().toISOString(),
    };

    res.status(201).json({
      message: "Proof issued successfully",
      proof: newProof,
    });
  } catch (error) {
    if (isInsufficientFundsError(error)) {
      res.status(400).json({
        error:
          "Issuer wallet has insufficient TestNet ALGO balance to pay network fees.",
        issuer: getIssuerAddress(),
        requiredForIssue: issueMinRecommendedMicroAlgos,
        fundingUrl: testnetFundingUrl,
      });
      return;
    }

    next(error);
  }
});

router.post("/proofs/verify", uploadSingleFile, async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: "A file upload is required" });
      return;
    }

    const transactionId = (req.body.transactionId || "").trim().toUpperCase();
    if (!transactionId) {
      res.status(400).json({ error: "Transaction ID is required" });
      return;
    }

    if (!/^[A-Z2-7]{52}$/.test(transactionId)) {
      res.status(400).json({ error: "Transaction ID format is invalid" });
      return;
    }

    const uploadedHash = computeSHA256(req.file.buffer);
    const transaction = await fetchTransactionById(transactionId);

    if (!transaction) {
      res.status(404).json({ error: "Transaction not found on Algorand TestNet" });
      return;
    }

    const onChainHash = parseHashFromTransaction(transaction);
    if (!onChainHash) {
      res.status(422).json({
        error:
          "No TrustChain hash was found in the transaction note field for this transaction",
      });
      return;
    }

    const verified = uploadedHash === onChainHash;

    res.json({
      status: verified ? "VERIFIED" : "INVALID",
      verified,
      transactionId,
      uploadedHash,
      onChainHash,
      confirmedRound: transaction["confirmed-round"] || null,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/proofs", async (_req, res, next) => {
  try {
    const transactions = await fetchIssuerTransactionHistory(200);
    const proofs = deriveProofsFromTransactions(transactions);

    res.json({ proofs });
  } catch (error) {
    if (isMissingMnemonicError(error)) {
      res.json({
        proofs: [],
        configurationError: error.message,
      });
      return;
    }

    next(error);
  }
});

router.get("/transactions/history", async (_req, res, next) => {
  try {
    const transactions = await fetchIssuerTransactionHistory(100);
    const issuedProofs = deriveProofsFromTransactions(transactions);

    res.json({
      issuer: getIssuerAddress(),
      count: transactions.length,
      transactions,
      issuedProofs,
    });
  } catch (error) {
    if (isMissingMnemonicError(error)) {
      res.json({
        issuer: null,
        count: 0,
        transactions: [],
        issuedProofs: [],
        configurationError: error.message,
      });
      return;
    }

    next(error);
  }
});

module.exports = router;
