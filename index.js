// index.js

import express from "express";
import axios from "axios";
import "dotenv/config";
import fs from "fs";

const messagesData = JSON.parse(
  fs.readFileSync(new URL("./messages.json", import.meta.url))
);


const app = express();
app.use(express.json());

// Environment variables
const token = process.env.WA_TOKEN;
const phoneID = process.env.PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const API_URL = `https://graph.facebook.com/v24.0/${phoneID}/messages`;

const processedMessages = new Set();

// Utility: Replace placeholders in message
function replacePlaceholders(message) {
  return message
    .replace('{{ebook_link}}', messagesData.ebook_link)
    .replace('{{bonus_link}}', messagesData.bonus_link)
    .replace('{{konsultan_wa}}', messagesData.konsultan_wa);
}

// Utility: Log with timestamp
function log(message, data = "") {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data);
}

// Get reply based on user input
function getReply(text) {
  const normalizedText = text.toLowerCase().trim();
  
  // Check for keyword matches
  const keywords = ['mulai', 'tips', 'bonus', 'autopilot', 'konsultasi', 'help'];
  
  for (const keyword of keywords) {
    if (normalizedText === keyword || normalizedText.includes(keyword)) {
      const response = messagesData.funnel[keyword];
      return {
        message: replacePlaceholders(response.message),
        reaction: response.reaction
      };
    }
  }
  
  // Default to welcome message
  const welcome = messagesData.funnel.welcome;
  return {
    message: replacePlaceholders(welcome.message),
    reaction: welcome.reaction
  };
}

// Send WhatsApp message
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
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
      }
    );
    log(`✅ Message sent to ${to}`);
    return response.data;
  } catch (err) {
  log(`❌ Error sending message:`, err.response?.data || err.message);
  console.error("FULL ERROR:", JSON.stringify(err.response?.data, null, 2));
  throw err;
}

}

// Mark message as read
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
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
      }
    );
    log(`✅ Message ${messageId} marked as read`);
  } catch (err) {
    log(`⚠️  Could not mark as read:`, err.response?.data?.error?.message);
  }
}

// Send reaction
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
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
      }
    );
    log(`✅ Reaction sent: ${emoji}`);
  } catch (err) {
    log(`⚠️  Could not send reaction:`, err.response?.data?.error?.message);
  }
}

// Cleanup processed messages cache
function cleanupCache() {
  if (processedMessages.size > 1000) {
    const arr = Array.from(processedMessages);
    processedMessages.clear();
    arr.slice(-500).forEach(id => processedMessages.add(id));
    log(`🧹 Cache cleaned. Current size: ${processedMessages.size}`);
  }
}

// Webhook verification (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const tokenSent = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && tokenSent === VERIFY_TOKEN) {
    log("✅ Webhook verified successfully");
    return res.status(200).send(challenge);
  }
  
  log("❌ Webhook verification failed");
  return res.sendStatus(403);
});

// Handle incoming messages (POST)
app.post("/webhook", async (req, res) => {
  // Respond immediately to prevent retries
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    // Not a message event
    if (!message) {
      return;
    }

    // Check for duplicate messages
    if (processedMessages.has(message.id)) {
      log(`⚠️  Duplicate message ignored: ${message.id}`);
      return;
    }
    
    processedMessages.add(message.id);
    cleanupCache();

    // Extract message details
    const from = message.from;
    const type = message.type;
    const textBody = message.text?.body || "";
    const messageId = message.id;

    log(`📩 Incoming message`, {
      from,
      type,
      body: textBody,
      id: messageId
    });

    // Only handle text messages
    if (type !== "text") {
      log(`⚠️  Unsupported message type: ${type}`);
      await sendMessage(from, messagesData.errors.unsupported_type);
      return;
    }

    // Get appropriate reply based on funnel
const { message: reply, reaction } = getReply(textBody);

// 🔽 tambahin blok ini
if (textBody.toLowerCase().includes("konsultasi")) {
  const adminNumber = "6281392290571"; 
  
  // kirim pesan ke user
  await sendMessage(from, replacePlaceholders(messagesData.funnel.konsultasi.message));
  
  // kirim notifikasi ke admin
  await sendMessage(
    adminNumber,
    `📩 Ada user baru minta konsultasi!\nNomor: ${from}\nPesan: "${textBody}"`
  );
  
  // kasih reaction ke user
  await sendReaction(from, messageId, messagesData.funnel.konsultasi.reaction);
  
  return; // stop di sini supaya gak lanjut ke reply umum
}

// Send reaction to acknowledge receipt
await sendReaction(from, messageId, reaction);


    // Simulate typing delay (3-5 seconds for natural feel)
    const delay = Math.floor(Math.random() * 2000);
    await new Promise(resolve => setTimeout(resolve, delay));

    log(`📤 Sending reply`);

    // Send reply
    await sendMessage(from, reply);

    // Mark message as read
    await markAsRead(messageId);

  } catch (err) {
    log(`❌ Error in webhook POST:`, err.response?.data || err.message);
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    bot: "Jalan Pintas Juragan Photobox",
    timestamp: new Date().toISOString(),
    cacheSize: processedMessages.size
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`🚀 Server running on port ${PORT}`);
  log(`📱 WhatsApp Phone ID: ${phoneID}`);
  log(`🔗 Webhook URL: http://localhost:${PORT}/webhook`);
  log(`💬 Bot: Jalan Pintas Juragan Photobox - Funnel Ready!`);
});


app.get("/", (req, res) => {
  res.send("✅ WhatsApp Cloud API bot is running!");
});
