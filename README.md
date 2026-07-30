# SnapGen AI Studio

Desktop app (Electron) tạo video AI multi-scene:

1. **ChatGPT** viết kịch bản nhiều cảnh  
2. **Snapgen** gen từng clip (Veo / Sora / Grok / Seedance / Kling / Meta)  
3. **ElevenLabs** tạo voice + subtitle  
4. **FFmpeg** ghép thành video cuối  

API keys cấu hình trong **Settings** trên UI (không cần `.env`).

## Chạy

```bash
npm install
npm start
```

Docs API Snapgen nằm ở `content/` và `openapi.json`.
