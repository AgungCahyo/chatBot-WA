// index.js - WhatsApp Cloud API Bot untuk Jalan Pintas Juragan Photobox

import express from "express";
import axios from "axios";
import "dotenv/config";
import fs from "fs";

// ========================================
// CONFIGURATION & INITIALIZATION
// ========================================

const app = express();
app.use(express.json());

// Load messages configuration
let messagesData;
try {
  messagesData = JSON.parse(
    fs.readFileSync(new URL("./messages.json", import.meta.url), "utf-8")
  );
} catch (error) {
  console.error("❌ Gagal membaca messages.json:", error.message);
  process.exit(1);
}

// Environment variables
const CONFIG = {
  token: process.env.WA_TOKEN,
  phoneID: process.env.PHONE_ID,
  verifyToken: process.env.VERIFY_TOKEN,
  adminNumber: process.env.ADMIN_NUMBER,
  port: process.env.PORT || 3000,
  apiVersion: "v24.0",
};

// Validate required environment variables
const requiredEnvVars = ["WA_TOKEN", "PHONE_ID", "VERIFY_TOKEN", "ADMIN_NUMBER"];
const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(", ")}`);
  process.exit(1);
}

const API_URL = `https://graph.facebook.com/${CONFIG.apiVersion}/${CONFIG.phoneID}/messages`;

// In-memory cache for processed messages
const processedMessages = new Set();
const CACHE_MAX_SIZE = 1000;
const CACHE_CLEANUP_SIZE = 500;

// Rate limiting configuration
const userLastMessageTime = new Map();
const RATE_LIMIT_WINDOW = 2000; // 2 seconds between messages

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Replace placeholders in message text with actual values
 * @param {string} message - Message template with placeholders
 * @returns {string} - Message with replaced placeholders
 */
function replacePlaceholders(message) {
  return message
    .replace(/{{ebook_link}}/g, messagesData.ebook_link)
    .replace(/{{bonus_link}}/g, messagesData.bonus_link)
    .replace(/{{konsultan_wa}}/g, messagesData.konsultan_wa);
}

/**
 * Log with timestamp for better debugging
 * @param {string} level - Log level (INFO, ERROR, WARN)
 * @param {string} message - Log message
 * @param {*} data - Additional data to log
 */
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

/**
 * Determine bot reply based on user text
 * @param {string} text - User message text
 * @returns {Object} - Reply object with message and reaction
 */
function getReply(text) {
  const normalizedText = text.toLowerCase().trim();
  
  // Define keywords and their priority (order matters)
  const keywordMap = [
    { keywords: ["konsultasi", "konsultan", "hubungi"], key: "konsultasi" },
    { keywords: ["autopilot", "franchise", "sistem"], key: "autopilot" },
    { keywords: ["bonus", "template", "download"], key: "bonus" },
    { keywords: ["tips", "strategi", "bep"], key: "tips" },
    { keywords: ["mulai", "start", "download ebook"], key: "mulai" },
    { keywords: ["help", "menu", "bantuan"], key: "help" },
  ];
  
  // Find matching keyword
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
  
  // Default to welcome message
  const welcome = messagesData.funnel.welcome;
  return {
    message: replacePlaceholders(welcome.message),
    reaction: welcome.reaction,
    keyword: "welcome"
  };
}

/**
 * Clean up message cache when it exceeds limit
 */
function cleanupCache() {
  if (processedMessages.size > CACHE_MAX_SIZE) {
    const arr = Array.from(processedMessages);
    processedMessages.clear();
    
    // Keep only the most recent messages
    arr.slice(-CACHE_CLEANUP_SIZE).forEach(id => processedMessages.add(id));
    
    log("INFO", `🧹 Cache cleaned. Remaining: ${processedMessages.size} messages`);
  }
}

/**
 * Check if user is rate limited
 * @param {string} userId - User phone number
 * @returns {boolean} - True if rate limited
 */
function isRateLimited(userId) {
  const lastMessageTime = userLastMessageTime.get(userId);
  const now = Date.now();
  
  if (lastMessageTime && (now - lastMessageTime) < RATE_LIMIT_WINDOW) {
    return true;
  }
  
  userLastMessageTime.set(userId, now);
  return false;
}

// ========================================
// WHATSAPP API FUNCTIONS
// ========================================

/**
 * Send WhatsApp message
 * @param {string} to - Recipient phone number
 * @param {string} body - Message body
 * @returns {Promise<Object>} - API response
 */
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
        timeout: 10000, // 10 second timeout
      }
    );
    
    log("INFO", `✅ Message sent to ${to}`);
    return response.data;
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    log("ERROR", `❌ Failed to send message to ${to}:`, errorMsg);
    
    // Log detailed error for debugging
    if (err.response?.data) {
      log("ERROR", "API Error Details:", JSON.stringify(err.response.data, null, 2));
    }
    
    throw err;
  }
}

/**
 * Mark message as read
 * @param {string} messageId - WhatsApp message ID
 */
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
    
    log("INFO", `📖 Message ${messageId} marked as read`);
  } catch (err) {
    log("WARN", `⚠️ Failed to mark message as read:`, err.response?.data?.error?.message || err.message);
  }
}

/**
 * Send reaction to user message
 * @param {string} to - Recipient phone number
 * @param {string} messageId - Message ID to react to
 * @param {string} emoji - Emoji reaction
 */
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
    
    log("INFO", `👍 Reaction sent: ${emoji} to ${to}`);
  } catch (err) {
    log("WARN", `⚠️ Failed to send reaction:`, err.response?.data?.error?.message || err.message);
  }
}

/**
 * Send typing indicator
 * @param {string} to - Recipient phone number
 */
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
    // Silently fail - typing indicator is not critical
    log("WARN", `⚠️ Failed to send typing indicator`, err.message);
  }
}

// ========================================
// WEBHOOK ENDPOINTS
// ========================================

/**
 * GET /webhook - Webhook verification endpoint
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const tokenSent = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  log("INFO", "📥 Webhook verification attempt", { mode, tokenSent });

  if (mode === "subscribe" && tokenSent === CONFIG.verifyToken) {
    log("INFO", "✅ Webhook verified successfully");
    return res.status(200).send(challenge);
  }
  
  log("WARN", "❌ Webhook verification failed - invalid token");
  return res.sendStatus(403);
});

/**
 * POST /webhook - Handle incoming WhatsApp messages
 */
app.post("/webhook", async (req, res) => {
  // Immediately respond to WhatsApp to prevent timeout
  res.sendStatus(200);

  try {
    // Extract message data from webhook payload
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    // Ignore non-message events
    if (!message) {
      log("INFO", "⏭️ Non-message event received, skipping");
      return;
    }

    const messageId = message.id;
    const from = message.from;
    const type = message.type;
    const textBody = message.text?.body || "";

    // Prevent duplicate message processing
    if (processedMessages.has(messageId)) {
      log("WARN", `⏭️ Duplicate message ignored: ${messageId}`);
      return;
    }
    
    processedMessages.add(messageId);
    cleanupCache();

    log("INFO", "📨 Incoming message", {
      from,
      type,
      body: textBody.substring(0, 50) + (textBody.length > 50 ? "..." : ""),
      id: messageId
    });

    // Rate limiting check
    if (isRateLimited(from)) {
      log("WARN", `⏱️ Rate limit hit for user: ${from}`);
      return;
    }

    // Only handle text messages
    if (type !== "text") {
      log("WARN", `❌ Unsupported message type: ${type}`);
      await sendMessage(from, messagesData.errors.unsupported_type);
      return;
    }

    // Determine appropriate reply
    const { message: reply, reaction, keyword } = getReply(textBody);

    log("INFO", `🎯 Keyword matched: ${keyword}`);

    // Special handling for consultation requests
    if (keyword === "konsultasi") {
      try {
        // Send typing indicator for better UX
        await sendTypingIndicator(from);
        
        // Small delay for natural feel
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Send message to user
        await sendMessage(from, reply);
        
        // Notify admin about consultation request
        const adminNotification = `🔔 *KONSULTASI REQUEST*\n\n` +
          `👤 Nomor: ${from}\n` +
          `💬 Pesan: "${textBody}"\n` +
          `⏰ Waktu: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}\n\n` +
          `Segera follow up untuk closing! 💰`;
        
        await sendMessage(CONFIG.adminNumber, adminNotification);
        
        // Send reaction
        await sendReaction(from, messageId, reaction);
        
        log("INFO", `✅ Consultation request processed for ${from}`);
        return;
      } catch (err) {
        log("ERROR", "❌ Error in consultation flow:", err.message);
        await sendMessage(from, messagesData.errors.general_error);
        return;
      }
    }

    // Standard message flow
    try {
      // Send reaction immediately
      await sendReaction(from, messageId, reaction);
      
      // Show typing indicator
      await sendTypingIndicator(from);
      
      // Random delay for natural conversation feel (1-3 seconds)
      const delay = Math.floor(Math.random() * 2000) + 1000;
      await new Promise(resolve => setTimeout(resolve, delay));

      log("INFO", `💬 Sending reply for keyword: ${keyword}`);

      // Send reply
      await sendMessage(from, reply);

      // Mark as read
      await markAsRead(messageId);

      log("INFO", `✅ Message flow completed for ${from}`);
    } catch (err) {
      log("ERROR", "❌ Error in message flow:", err.message);
      
      // Try to send error message to user
      try {
        await sendMessage(from, messagesData.errors.general_error);
      } catch (recoveryErr) {
        log("ERROR", "❌ Failed to send error message to user:", recoveryErr.message);
      }
    }

  } catch (err) {
    log("ERROR", "❌ Critical error in webhook POST handler:", err.message);
    if (err.stack) {
      log("ERROR", "Stack trace:", err.stack);
    }
  }
});

// ========================================
// HEALTH & STATUS ENDPOINTS
// ========================================

/**
 * GET /health - Health check endpoint
 */
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

/**
 * GET / - Root endpoint
 */
app.get("/", (req, res) => {
  res.json({
    message: "WhatsApp Cloud API Bot - Jalan Pintas Juragan Photobox",
    status: "running",
    version: "2.0.0",
    endpoints: {
      webhook: "/webhook",
      health: "/health"
    }
  });
});

/**
 * GET /stats - Statistics endpoint (optional, for monitoring)
 */
app.get("/stats", (req, res) => {
  res.json({
    processedMessages: processedMessages.size,
    activeUsers: userLastMessageTime.size,
    uptime: Math.floor(process.uptime()),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// ========================================
// ERROR HANDLING & SERVER STARTUP
// ========================================

/**
 * Global error handler
 */
app.use((err, req, res, next) => {
  log("ERROR", "❌ Unhandled error:", err.message);
  res.status(500).json({ 
    error: "Internal server error",
    message: "An unexpected error occurred"
  });
});

/**
 * Handle 404 routes
 */
app.use((req, res) => {
  res.status(404).json({ 
    error: "Not found",
    message: "The requested endpoint does not exist"
  });
});

/**
 * Start server
 */
const server = app.listen(CONFIG.port, () => {
  console.log("\n" + "=".repeat(60));
  log("INFO", "🚀 WhatsApp Bot Server Started");
  console.log("=".repeat(60));
  log("INFO", `📱 Bot: Jalan Pintas Juragan Photobox`);
  log("INFO", `🌐 Port: ${CONFIG.port}`);
  log("INFO", `📞 Phone ID: ${CONFIG.phoneID}`);
  log("INFO", `🔗 Webhook URL: http://localhost:${CONFIG.port}/webhook`);
  log("INFO", `💚 Health Check: http://localhost:${CONFIG.port}/health`);
  console.log("=".repeat(60) + "\n");
  log("INFO", "✅ Bot is ready to receive messages!");
});

/**
 * Graceful shutdown
 */
process.on("SIGTERM", () => {
  log("INFO", "🛑 SIGTERM signal received: closing HTTP server");
  server.close(() => {
    log("INFO", "✅ HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  log("INFO", "🛑 SIGINT signal received: closing HTTP server");
  server.close(() => {
    log("INFO", "✅ HTTP server closed");
    process.exit(0);
  });
});

/**
 * Handle uncaught exceptions
 */
process.on("uncaughtException", (err) => {
  log("ERROR", "❌ Uncaught Exception:", err.message);
  log("ERROR", "Stack:", err.stack);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  log("ERROR", "❌ Unhandled Rejection at:", promise);
  log("ERROR", "Reason:", reason);
});