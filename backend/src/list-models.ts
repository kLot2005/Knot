import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "../.env") });

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    try {
        // Мы используем fetch напрямую, так как SDK может скрывать детали
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await response.json();
        console.log("Доступные модели:");
        if (data.models) {
            data.models.forEach((m: any) => {
                console.log(`- ${m.name} (supports: ${m.supportedGenerationMethods.join(', ')})`);
            });
        } else {
            console.log("Модели не найдены или ошибка API:", data);
        }
    } catch (e) {
        console.error("Ошибка при получении списка моделей:", e);
    }
}

listModels();
