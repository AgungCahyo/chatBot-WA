// index.js

import express from "express";
import axios from "axios";
import "dotenv/config";

const app = express();
app.use(express.json());

const token = process.env.WA_TOKEN ;
const phoneID = process.env.PHONE_ID ;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN ;
const API_URL = `https://graph.facebook.com/v24.0/${phoneID}/messages`;

const processedMessages = new Set();

const commands = {
  harga: `*Daftar Harga Produk*\n\n` +
         `• Produk A: Rp 100.000\n` +
         `• Produk B: Rp 200.000\n` +
         `• Produk C: Rp 350.000\n\n` +
         `_Harga belum termasuk ongkir_`,
  
  promo: `*Promo Bulan Ini*\n\n` +
         `• Diskon 20% untuk pembelian >Rp 500.000\n` +
         `• Gratis ongkir minimal Rp 300.000\n` +
         `• Buy 2 Get 1 untuk Produk A\n\n` +
         `_Promo berlaku hingga akhir bulan_`,
  
  help: `*Selamat datang di Chatbot Kami!*\n\n` +
        `Ketik perintah berikut:\n` +
        `• *harga* - Lihat daftar harga\n` +
        `• *promo* - Lihat promo terbaru\n` +
        `• *kontak* - Hubungi customer service\n` +
        `• *help* - Tampilkan menu ini`,
  
  kontak: `*Hubungi Kami*\n\n` +
          `WhatsApp: 0812-3456-7890\n` +
          `Email: info@example.com\n` +
          `Jam operasional: 09.00 - 17.00 WIB`,
};

function log(message, data = "") {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data);
}

function getReply(text) {
  const normalizedText = text.toLowerCase().trim();
  
  for (const [keyword, response] of Object.entries(commands)) {
    if (normalizedText.includes(keyword)) {
      return response;
    }
  }
  
  return `Halo! Terima kasih sudah menghubungi kami.\n\n` +
         `Ketik *help* untuk melihat menu yang tersedia.`;
}

// Utility: Send WhatsApp message
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
    log(`✅ Message sent to ${to}`, response.data);
  } catch (err) {
    log(`❌ Error sending message:`, err.response?.data || err.message);
    throw err;
  }
}

// Utility: Mark message as read
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

// Utility: Send reaction
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

    // Not a message event (could be status update, etc.)
    if (!message) {
      return;
    }

    // Check for duplicate messages
    if (processedMessages.has(message.id)) {
      log(`Duplicate message ignored: ${message.id}`);
      return;
    }
    
    processedMessages.add(message.id);
    cleanupCache();

    // Extract message details
    const from = message.from;
    const type = message.type;
    const textBody = message.text?.body || "";
    const messageId = message.id;

    log(`Incoming message`, {
      from,
      type,
      body: textBody,
      id: messageId
    });

    // Only handle text messages for now
    if (type !== "text") {
      log(`Unsupported message type: ${type}`);
      await sendMessage(from, "Maaf, saat ini bot hanya bisa membalas pesan teks.");
      return;
    }

    // Send reaction to acknowledge receipt
    await sendReaction(from, messageId, "👀");

    // Get appropriate reply
    const reply = getReply(textBody);

    // Small delay to simulate typing (optional)
    await new Promise(resolve => setTimeout(resolve, 500));
log(`Sending reply: ${reply}`);

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
    timestamp: new Date().toISOString(),
    cacheSize: processedMessages.size
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`Server running on port ${PORT}`);
  log(`WhatsApp Phone ID: ${phoneID}`);
  log(`Webhook URL: http://localhost:${PORT}/webhook`);
});