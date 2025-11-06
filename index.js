// index.js

import express from "express";
import axios from "axios";
import "dotenv/config";
import fs from "fs";

// Membaca file messages.json untuk data pesan otomatis
const messagesData = JSON.parse(
  fs.readFileSync(new URL("./messages.json", import.meta.url))
);

const app = express();
app.use(express.json());

// Variabel environment dari file .env
const token = process.env.WA_TOKEN;
const phoneID = process.env.PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ADMIN_NUMBER = process.env.ADMIN_NUMBER;
const API_URL = `https://graph.facebook.com/v24.0/${phoneID}/messages`;

// Menyimpan ID pesan yang sudah diproses untuk mencegah duplikasi
const processedMessages = new Set();

// Fungsi untuk mengganti placeholder dalam teks pesan
function replacePlaceholders(message) {
  return message
    .replace('{{ebook_link}}', messagesData.ebook_link)
    .replace('{{bonus_link}}', messagesData.bonus_link)
    .replace('{{konsultan_wa}}', messagesData.konsultan_wa);
}

// Fungsi untuk menampilkan log dengan timestamp
function log(message, data = "") {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data);
}

// Fungsi untuk menentukan balasan berdasarkan teks user
function getReply(text) {
  const normalizedText = text.toLowerCase().trim();
  
  // Kata kunci yang dikenali bot
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
  
  // Jika tidak cocok dengan kata kunci apa pun, kirim pesan sambutan
  const welcome = messagesData.funnel.welcome;
  return {
    message: replacePlaceholders(welcome.message),
    reaction: welcome.reaction
  };
}

// Fungsi untuk mengirim pesan WhatsApp
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
    log(`Pesan terkirim ke ${to}`);
    return response.data;
  } catch (err) {
    log(`Gagal mengirim pesan:`, err.response?.data || err.message);
    console.error("Detail Error:", JSON.stringify(err.response?.data, null, 2));
    throw err;
  }
}

// Fungsi untuk menandai pesan sebagai sudah dibaca
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
    log(`Pesan ${messageId} ditandai sudah dibaca`);
  } catch (err) {
    log(`Gagal menandai pesan sebagai dibaca:`, err.response?.data?.error?.message);
  }
}

// Fungsi untuk mengirim reaksi ke pesan user
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
    log(`Reaksi dikirim: ${emoji}`);
  } catch (err) {
    log(`Gagal mengirim reaksi:`, err.response?.data?.error?.message);
  }
}

// Fungsi untuk membersihkan cache pesan yang sudah terlalu banyak
function cleanupCache() {
  if (processedMessages.size > 1000) {
    const arr = Array.from(processedMessages);
    processedMessages.clear();
    arr.slice(-500).forEach(id => processedMessages.add(id));
    log(`Cache dibersihkan. Total tersisa: ${processedMessages.size}`);
  }
}

// Endpoint GET untuk verifikasi webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const tokenSent = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && tokenSent === VERIFY_TOKEN) {
    log("Webhook berhasil diverifikasi");
    return res.status(200).send(challenge);
  }
  
  log("Verifikasi webhook gagal");
  return res.sendStatus(403);
});

// Endpoint POST untuk menangani pesan masuk
app.post("/webhook", async (req, res) => {
  // Balas langsung ke WhatsApp agar tidak dianggap timeout
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    // Jika bukan event pesan, hentikan
    if (!message) return;

    // Cegah duplikasi pesan
    if (processedMessages.has(message.id)) {
      log(`Pesan duplikat diabaikan: ${message.id}`);
      return;
    }
    
    processedMessages.add(message.id);
    cleanupCache();

    // Ambil detail pesan
    const from = message.from;
    const type = message.type;
    const textBody = message.text?.body || "";
    const messageId = message.id;

    log(`Pesan masuk`, {
      from,
      type,
      body: textBody,
      id: messageId
    });

    // Hanya tangani pesan teks
    if (type !== "text") {
      log(`Tipe pesan tidak didukung: ${type}`);
      await sendMessage(from, messagesData.errors.unsupported_type);
      return;
    }

    // Tentukan balasan sesuai teks user
    const { message: reply, reaction } = getReply(textBody);

    // Jika user mengetik "konsultasi"
    if (textBody.toLowerCase().includes("konsultasi")) {
      
      // Kirim pesan ke user
      await sendMessage(from, replacePlaceholders(messagesData.funnel.konsultasi.message));
      
      // Kirim notifikasi ke admin
      await sendMessage(
        ADMIN_NUMBER,
        `Ada user baru yang meminta konsultasi.\nNomor: ${from}\nPesan: "${textBody}"`
      );
      
      // Kirim reaksi ke user
      await sendReaction(from, messageId, messagesData.funnel.konsultasi.reaction);
      
      return; 
    }

    // Kirim reaksi sebagai tanda pesan diterima
    await sendReaction(from, messageId, reaction);

    // Beri jeda agar terasa alami (2 detik acak)
    const delay = Math.floor(Math.random() * 2000);
    await new Promise(resolve => setTimeout(resolve, delay));

    log(`Mengirim balasan...`);

    // Kirim balasan ke user
    await sendMessage(from, reply);

    // Tandai pesan sudah dibaca
    await markAsRead(messageId);

  } catch (err) {
    log(`Terjadi kesalahan pada webhook POST:`, err.response?.data || err.message);
  }
});

// Endpoint untuk pengecekan status server
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    bot: "Jalan Pintas Juragan Photobox",
    timestamp: new Date().toISOString(),
    cacheSize: processedMessages.size
  });
});

// Jalankan server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`Server berjalan di port ${PORT}`);
  log(`WhatsApp Phone ID: ${phoneID}`);
  log(`Webhook URL: http://localhost:${PORT}/webhook`);
  log(`Bot Jalan Pintas Juragan Photobox siap dijalankan`);
});

// Endpoint default
app.get("/", (req, res) => {
  res.send("WhatsApp Cloud API bot sedang berjalan.");
});
