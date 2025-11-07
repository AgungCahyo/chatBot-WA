// index.js - Bot WhatsApp Cloud API untuk Jalan Pintas Juragan Photobox

import express from "express";
import axios from "axios";
import "dotenv/config";
import fs from "fs";

// KONFIGURASI & INISIALISASI

const app = express();
app.use(express.json());

// Load konfigurasi pesan
let messagesData;
try {
  messagesData = JSON.parse(
    fs.readFileSync(new URL("./messages.json", import.meta.url), "utf-8")
  );
} catch (error) {
  console.error("❌ Gagal membaca messages.json:", error.message);
  process.exit(1);
}

// Variabel environment
const CONFIG = {
  token: process.env.WA_TOKEN,
  phoneID: process.env.PHONE_ID,
  verifyToken: process.env.VERIFY_TOKEN,
  adminNumber: process.env.ADMIN_NUMBER,
  port: process.env.PORT || 3000,
  apiVersion: "v24.0",
};

// Validasi environment variable yang wajib ada
const requiredEnvVars = ["WA_TOKEN", "PHONE_ID", "VERIFY_TOKEN", "ADMIN_NUMBER"];
const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`❌ Environment variable wajib tidak ditemukan: ${missingVars.join(", ")}`);
  process.exit(1);
}

const API_URL = `https://graph.facebook.com/${CONFIG.apiVersion}/${CONFIG.phoneID}/messages`;

// Cache sementara untuk pesan yang sudah diproses
const processedMessages = new Set();
const CACHE_MAX_SIZE = 1000;
const CACHE_CLEANUP_SIZE = 500;

// Konfigurasi rate limit
const userLastMessageTime = new Map();
const RATE_LIMIT_WINDOW = 2000; // 2 detik antar pesan

// FUNGSI UTILITY

function replacePlaceholders(message) {
  return message
    .replace(/{{ebook_link}}/g, messagesData.ebook_link)
    .replace(/{{bonus_link}}/g, messagesData.bonus_link)
    .replace(/{{konsultan_wa}}/g, messagesData.konsultan_wa);
}

function log(level = "INFO", message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;
  
  if (level === "ERROR") {
    console.error(logMessage, data || "");
  } else if (level === "WARN") {
    console.warn(logMessage, data || "");
  } else {
    console.log(logMessage, data || "");
  }
}

function getReply(text) {
  const normalizedText = text.toLowerCase().trim();
  
  // Daftar kata kunci dan prioritasnya (urutan penting)
  const keywordMap = [
    { keywords: ["konsultasi", "konsultan", "hubungi"], key: "konsultasi" },
    { keywords: ["autopilot", "franchise", "sistem"], key: "autopilot" },
    { keywords: ["bonus", "template", "download"], key: "bonus" },
    { keywords: ["tips", "strategi", "bep"], key: "tips" },
    { keywords: ["mulai", "start", "download ebook"], key: "mulai" },
    { keywords: ["help", "menu", "bantuan"], key: "help" },
  ];
  
  // Cari kata kunci yang cocok
  for (const { keywords, key } of keywordMap) {
    if (keywords.some(keyword => normalizedText.includes(keyword))) {
      const response = messagesData.funnel[key];
      if (response) {
        return {
          message: replacePlaceholders(response.message),
          reaction: response.reaction,
          keyword: key
        };
      }
    }
  }
  
  // Default ke pesan selamat datang
  const welcome = messagesData.funnel.welcome;
  return {
    message: replacePlaceholders(welcome.message),
    reaction: welcome.reaction,
    keyword: "welcome"
  };
}

function cleanupCache() {
  if (processedMessages.size > CACHE_MAX_SIZE) {
    const arr = Array.from(processedMessages);
    processedMessages.clear();
    
    // Simpan hanya pesan terbaru
    arr.slice(-CACHE_CLEANUP_SIZE).forEach(id => processedMessages.add(id));
    
    log("INFO", `🧹 Cache dibersihkan. Sisa: ${processedMessages.size} pesan`);
  }
}

function isRateLimited(userId) {
  const lastMessageTime = userLastMessageTime.get(userId);
  const now = Date.now();
  
  if (lastMessageTime && (now - lastMessageTime) < RATE_LIMIT_WINDOW) {
    return true;
  }
  
  userLastMessageTime.set(userId, now);
  return false;
}

// FUNGSI WHATSAPP API

async function sendMessage(to, body) {
  try {
    const response = await axios.post(
      API_URL,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "text",
        text: { body: body },
      },
      {
        headers: { 
          "Authorization": `Bearer ${CONFIG.token}`,
          "Content-Type": "application/json"
        },
        timeout: 10000,
      }
    );
    
    log("INFO", `✅ Pesan terkirim ke ${to}`);
    return response.data;
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    log("ERROR", `❌ Gagal mengirim pesan ke ${to}:`, errorMsg);
    
    if (err.response?.data) {
      log("ERROR", "Detail error API:", JSON.stringify(err.response.data, null, 2));
    }
    
    throw err;
  }
}

async function markAsRead(messageId) {
  try {
    await axios.post(
      API_URL,
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      },
      {
        headers: { 
          "Authorization": `Bearer ${CONFIG.token}`,
          "Content-Type": "application/json"
        },
        timeout: 5000,
      }
    );
    
    log("INFO", `📖 Pesan ${messageId} ditandai sudah dibaca`);
  } catch (err) {
    log("WARN", `⚠️ Gagal menandai pesan sudah dibaca:`, err.response?.data?.error?.message || err.message);
  }
}

async function sendReaction(to, messageId, emoji) {
  try {
    await axios.post(
      API_URL,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "reaction",
        reaction: { 
          message_id: messageId, 
          emoji: emoji 
        }
      },
      {
        headers: { 
          "Authorization": `Bearer ${CONFIG.token}`,
          "Content-Type": "application/json"
        },
        timeout: 5000,
      }
    );
    
    log("INFO", `👍 Reaksi ${emoji} terkirim ke ${to}`);
  } catch (err) {
    log("WARN", `⚠️ Gagal mengirim reaksi:`, err.response?.data?.error?.message || err.message);
  }
}

async function sendTypingIndicator(to) {
  try {
    await axios.post(
      API_URL,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "typing",
      },
      {
        headers: { 
          "Authorization": `Bearer ${CONFIG.token}`,
          "Content-Type": "application/json"
        },
        timeout: 5000,
      }
    );
  } catch (err) {
    log("WARN", `⚠️ Gagal mengirim indikator mengetik`, err.message);
  }
}

// ENDPOINT WEBHOOK

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const tokenSent = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  log("INFO", "📥 Percobaan verifikasi webhook", { mode, tokenSent });

  if (mode === "subscribe" && tokenSent === CONFIG.verifyToken) {
    log("INFO", "✅ Webhook berhasil diverifikasi");
    return res.status(200).send(challenge);
  }
  
  log("WARN", "❌ Verifikasi webhook gagal - token salah");
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Respon cepat agar WhatsApp tidak timeout

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      log("INFO", "⏭️ Event bukan pesan, dilewati");
      return;
    }

    const messageId = message.id;
    const from = message.from;
    const type = message.type;
    const textBody = message.text?.body || "";

    if (processedMessages.has(messageId)) {
      log("WARN", `⏭️ Pesan duplikat diabaikan: ${messageId}`);
      return;
    }
    
    processedMessages.add(messageId);
    cleanupCache();

    log("INFO", "📨 Pesan masuk", {
      from,
      type,
      body: textBody.substring(0, 50) + (textBody.length > 50 ? "..." : ""),
      id: messageId
    });

    if (isRateLimited(from)) {
      log("WARN", `⏱️ Rate limit kena untuk pengguna: ${from}`);
      return;
    }

    if (type !== "text") {
      log("WARN", `❌ Tipe pesan tidak didukung: ${type}`);
      await sendMessage(from, messagesData.errors.unsupported_type);
      return;
    }

    const { message: reply, reaction, keyword } = getReply(textBody);
    log("INFO", `🎯 Kata kunci cocok: ${keyword}`);

    if (keyword === "konsultasi") {
      try {
        await sendTypingIndicator(from);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await sendMessage(from, reply);

        const adminNotification = `🔔 *PERMINTAAN KONSULTASI*\n\n` +
          `👤 Nomor: ${from}\n` +
          `💬 Pesan: "${textBody}"\n` +
          `⏰ Waktu: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}\n\n` +
          `Segera follow up untuk closing! 💰`;
        
        await sendMessage(CONFIG.adminNumber, adminNotification);
        await sendReaction(from, messageId, reaction);
        
        log("INFO", `✅ Permintaan konsultasi diproses untuk ${from}`);
        return;
      } catch (err) {
        log("ERROR", "❌ Error saat memproses konsultasi:", err.message);
        await sendMessage(from, messagesData.errors.general_error);
        return;
      }
    }

    try {
      await sendReaction(from, messageId, reaction);
      await sendTypingIndicator(from);
      const delay = Math.floor(Math.random() * 2000) + 1000;
      await new Promise(resolve => setTimeout(resolve, delay));

      log("INFO", `💬 Mengirim balasan untuk kata kunci: ${keyword}`);
      await sendMessage(from, reply);
      await markAsRead(messageId);

      log("INFO", `✅ Alur pesan selesai untuk ${from}`);
    } catch (err) {
      log("ERROR", "❌ Error dalam alur pesan:", err.message);
      try {
        await sendMessage(from, messagesData.errors.general_error);
      } catch (recoveryErr) {
        log("ERROR", "❌ Gagal mengirim pesan error ke pengguna:", recoveryErr.message);
      }
    }

  } catch (err) {
    log("ERROR", "❌ Error kritis di webhook POST:", err.message);
    if (err.stack) {
      log("ERROR", "Stack trace:", err.stack);
    }
  }
});

// ENDPOINT HEALTH & STATUS

app.get("/health", (req, res) => {
  const uptime = process.uptime();
  const uptimeFormatted = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`;
  
  res.json({ 
    status: "healthy",
    bot: "Jalan Pintas Juragan Photobox",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    uptime: uptimeFormatted,
    cache: {
      size: processedMessages.size,
      maxSize: CACHE_MAX_SIZE
    },
    environment: {
      phoneID: CONFIG.phoneID,
      apiVersion: CONFIG.apiVersion
    }
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "Bot WhatsApp Cloud API - Jalan Pintas Juragan Photobox",
    status: "running",
    version: "2.0.0",
    endpoints: {
      webhook: "/webhook",
      health: "/health"
    }
  });
});

app.get("/stats", (req, res) => {
  res.json({
    processedMessages: processedMessages.size,
    activeUsers: userLastMessageTime.size,
    uptime: Math.floor(process.uptime()),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// ERROR HANDLING & START SERVER

app.use((err, req, res, next) => {
  log("ERROR", "❌ Error tidak tertangani:", err.message);
  res.status(500).json({ 
    error: "Internal server error",
    message: "Terjadi kesalahan yang tidak terduga"
  });
});

app.use((req, res) => {
  res.status(404).json({ 
    error: "Not found",
    message: "Endpoint yang diminta tidak ditemukan"
  });
});

const server = app.listen(CONFIG.port, () => {
  console.log("\n" + "=".repeat(60));
  log("INFO", "🚀 Server WhatsApp Bot dimulai");
  console.log("=".repeat(60));
  log("INFO", `📱 Bot: Jalan Pintas Juragan Photobox`);
  log("INFO", `🌐 Port: ${CONFIG.port}`);
  log("INFO", `📞 Phone ID: ${CONFIG.phoneID}`);
  log("INFO", `🔗 Webhook URL: http://localhost:${CONFIG.port}/webhook`);
  log("INFO", `💚 Health Check: http://localhost:${CONFIG.port}/health`);
  console.log("=".repeat(60) + "\n");
  log("INFO", "✅ Bot siap menerima pesan!");
});

// HANDLE SIGNAL & EXCEPTIONS

process.on("SIGTERM", () => {
  log("INFO", "🛑 SIGTERM diterima: menutup server HTTP");
  server.close(() => {
    log("INFO", "✅ Server HTTP ditutup");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  log("INFO", "🛑 SIGINT diterima: menutup server HTTP");
  server.close(() => {
    log("INFO", "✅ Server HTTP ditutup");
    process.exit(0);
  });
});

process.on("uncaughtException", (err) => {
  log("ERROR", "❌ Uncaught Exception:", err.message);
  log("ERROR", "Stack:", err.stack);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  log("ERROR", "❌ Unhandled Rejection di:", promise);
  log("ERROR", "Alasan:", reason);
});
