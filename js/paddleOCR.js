// paddleOCR.js
// PaddleOCR.js 瀏覽器版測試

import { PaddleOCR } from
  "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm";

let paddleOCR = null;

/**
 * 初始化 PaddleOCR
 */
async function createPaddleOCR() {
  if (paddleOCR) {
    return paddleOCR;
  }

  paddleOCR = await PaddleOCR.create({
    lang: "ch",
    ocrVersion: "PP-OCRv5",
    ortOptions: {
      backend: "auto"
    }
  });

  return paddleOCR;
}

/**
 * 辨識圖片
 */
async function recognizeImage(file) {
  if (!file) {
    throw new Error("請先選擇圖片。");
  }

  const ocr = await createPaddleOCR();

  const [result] = await ocr.predict(file);

  return {
    fileName: file.name,
    image: result.image,
    items: result.items.map(item => ({
      text: item.text,
      score: item.score,
      poly: item.poly
    })),
    metrics: result.metrics
  };
}

// 對外提供
window.PaddleOCRTest = {
  recognizeImage
};
