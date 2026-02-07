import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import multer from "multer";
import "dotenv/config";
import path from "path";
import fs from "fs";

const app = express();

// Penyimpanan presisten data
const dataDir = path.join(process.cwd(), "data");
const UPLOAD_DIR = path.join(dataDir, "uploads");
const DATABASE_FILE = path.join(dataDir, "maira_memory.json");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Atur multer buat nyimpen sementara di folder data/uploads
const upload = multer({ dest: UPLOAD_DIR });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

// DB memori Maira
let mairaMemory = [];

// Ambil data saat server pertama kali nyala
if (fs.existsSync(DATABASE_FILE)) {
  try {
    const rawData = fs.readFileSync(DATABASE_FILE);
    mairaMemory = JSON.parse(rawData);
    console.log(`📚 Maira memuat ${mairaMemory.length} dokumen dari ingatan lamanya.`);
  } catch (e) {
    console.error("Gagal membaca memori lama, mulai dari nol.");
    mairaMemory = [];
  }
}

// Fungsi simpan memori ke disk
const saveMemoryToDisk = () => {
  fs.writeFileSync(DATABASE_FILE, JSON.stringify(mairaMemory, null, 2));
};

app.use(express.json());
app.use(express.static("public"));

// Endpoint deteksi model AI
let cachedModelName = null;
async function getValidModel() {
  if (cachedModelName) return cachedModelName;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    const found = data.models.find((m) => m.supportedGenerationMethods.includes("generateContent"));
    cachedModelName = found ? found.name.split("/").pop() : "gemini-1.5-flash";
    console.log(`🔎 Pakai Model: ${cachedModelName}`);
    return cachedModelName;
  } catch (e) {
    return "gemini-1.5-flash";
  }
}

// Endpoint chat dan upload
app.post("/chat", upload.array("pdf", 10), async (req, res) => {
  try {
    const { message } = req.body;

    // Proses File Baru jika ada
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        console.log(`📤 Menyimpan SOP baru: ${file.originalname}`);
        const uploadResult = await fileManager.uploadFile(file.path, {
          mimeType: "application/pdf",
          displayName: file.originalname,
        });

        mairaMemory.push({
          fileData: { mimeType: uploadResult.file.mimeType, fileUri: uploadResult.file.uri },
          fileName: file.originalname,
        });

        // Hapus file fisik setelah diupload ke Google AI
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
      saveMemoryToDisk();
    }

    const targetModel = await getValidModel();
    const model = genAI.getGenerativeModel({
      model: targetModel,
      systemInstruction: `NAMA & PERAN: Maira, asisten di bidang produksi PT. Well Maira Food.

      ATURAN MERESPON (SANGAT PENTING):
      1. JANGAN memberikan salam (seperti Halo, Hai, Selamat pagi, dll) jika kamu sedang menjawab pertanyaan teknis atau pertanyaan lanjutan. 
      2. HANYA berikan salam JIKA pesan user adalah sapaan pertama kali (seperti "Halo", "Maira").
      3. Jika user bertanya tentang SOP/isi dokumen, LANGSUNG jawab ke intinya tanpa basa-basi pembuka.
      4. Jawab HANYA berdasarkan dokumen yang ada. Jika tidak ada, bilang jujur.
      5. Gunakan bahasa santai Saya namun tetap informatif.
      6. Selalu ingat aspek K3 di akhir jawaban jika relevan dengan instruksi kerja.
      
      ATURAN SUMBER:
      1. Di akhir setiap jawaban, kamu WAJIB menuliskan sumber dokumen yang kamu pakai dengan format: [Sumber: NamaFile1.pdf, NamaFile2.pdf]
      2. Jika jawaban diambil dari lebih dari satu dokumen, sebutkan semuanya.
      3. Jika kamu menjawab berdasarkan ingatan umum karena tidak ada di dokumen (setelah memberi disclaimer), jangan tuliskan sumber ini.`,
    });

    // Menggabung file upload dan teks
    let parts = mairaMemory.map((item) => ({
      fileData: { mimeType: item.fileData.mimeType, fileUri: item.fileData.fileUri },
    }));
    parts.push({ text: message || "Halo Maira!" });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
    });

    res.json({
      reply: result.response.text(),
      currentFiles: mairaMemory.map((f) => f.fileName),
    });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Reset endpoint (hapus memori/pengetahuan)
app.post("/reset", (req, res) => {
  mairaMemory = [];
  if (fs.existsSync(DATABASE_FILE)) fs.unlinkSync(DATABASE_FILE);
  console.log("🗑️ Semua ingatan dihapus.");
  res.json({ message: "Ingatan permanen telah dibersihkan!" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Maira siap bertugas di port ${PORT}`);
});
