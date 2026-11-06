// expenseOCR.js
// PDF 文字擷取 + 圖片 OCR
(() => {
  const PDF_WORKER_URL =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  // PDF.js worker 設定
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  }

  /**
   * 建立 Tesseract OCR Worker
   */
  async function createOCRWorker(onProgress) {
    if (!window.Tesseract) {
      throw new Error("Tesseract.js 尚未載入，請檢查 index.html 的 script 順序。");
    }

    const worker = await window.Tesseract.createWorker(
      "chi_tra+eng",
      1,
      {
        logger: (message) => {
          if (typeof onProgress === "function") {
            onProgress(message);
          }
        }
      }
    );

    await worker.setParameters({
      preserve_interword_spaces: "1"
    });

    return worker;
  }

  /**
   * 將 Canvas 交給 OCR 辨識
   */
  async function recognizeCanvas(canvas, worker) {
    const result = await worker.recognize(canvas);
    const data = result.data;

    return {
      text: data.text || "",
      words: (data.words || []).map((word) => ({
        text: word.text,
        confidence: word.confidence,
        bbox: word.bbox
      }))
    };
  }

  /**
   * 讀取圖片並執行 OCR
   */
  async function readImage(file, onProgress) {
    const worker = await createOCRWorker(onProgress);

    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");

      canvas.width = bitmap.width;
      canvas.height = bitmap.height;

      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();

      const result = await recognizeCanvas(canvas, worker);

      return {
        fileName: file.name,
        fileType: "image",
        pages: [
          {
            pageNumber: 1,
            source: "ocr",
            text: result.text,
            words: result.words
          }
        ]
      };
    } finally {
      await worker.terminate();
    }
  }

  /**
   * 讀取 PDF
   *
   * 有文字層：使用 PDF.js 擷取文字
   * 沒有足夠文字：將該頁轉成圖片，再使用 OCR
   */
  async function readPDF(file, onProgress) {
    if (!window.pdfjsLib) {
      throw new Error("PDF.js 尚未載入，請檢查 index.html 的 script 順序。");
    }

    const buffer = await file.arrayBuffer();

    const pdf = await window.pdfjsLib.getDocument({
      data: new Uint8Array(buffer)
    }).promise;

    const pages = [];

    // 只有需要 OCR 的頁面才建立 Worker
    let worker = null;

    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        if (typeof onProgress === "function") {
          onProgress({
            status: "reading-page",
            pageNumber,
            totalPages: pdf.numPages
          });
        }

        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();

        const textItems = (textContent.items || [])
          .filter((item) => item.str && item.str.trim())
          .map((item) => ({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            height: item.height
          }));

        const pageText = textItems
          .map((item) => item.text)
          .join(" ");

        // 文字層足夠時，先使用 PDF 原始文字
        const hasTextLayer =
          textItems.length >= 5 &&
          pageText.trim().length >= 30;

        if (hasTextLayer) {
          pages.push({
            pageNumber,
            source: "pdf-text",
            text: pageText,
            textItems,
            words: []
          });

          continue;
        }

        // 文字層不足時，改用 OCR
        if (!worker) {
          worker = await createOCRWorker(onProgress);
        }

        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        const context = canvas.getContext("2d");

        await page.render({
          canvasContext: context,
          viewport
        }).promise;

        const result = await recognizeCanvas(canvas, worker);

        pages.push({
          pageNumber,
          source: "ocr",
          text: result.text,
          textItems: [],
          words: result.words
        });
      }

      return {
        fileName: file.name,
        fileType: "pdf",
        totalPages: pdf.numPages,
        pages
      };
    } finally {
      if (worker) {
        await worker.terminate();
      }
    }
  }

  /**
   * 對外提供的文件讀取入口
   */
  async function readDocument(file, onProgress) {
    if (!file) {
      throw new Error("請先選擇文件。");
    }

    const fileName = file.name.toLowerCase();

    if (file.type === "application/pdf" || fileName.endsWith(".pdf")) {
      return readPDF(file, onProgress);
    }

    if (
      file.type.startsWith("image/") ||
      /\.(jpg|jpeg|png)$/i.test(fileName)
    ) {
      return readImage(file, onProgress);
    }

    throw new Error("目前只支援 PDF、JPG、JPEG、PNG 檔案。");
  }

  // 提供給其他 JS 檔案使用
  window.ExpenseOCR = {
    readDocument
  };

  // 暫時測試用
  document.addEventListener("DOMContentLoaded", () => {
    const fileInput = document.getElementById("ocrTestFile");
    const button = document.getElementById("ocrTestButton");
    const status = document.getElementById("ocrTestStatus");
    const result = document.getElementById("ocrTestResult");
  
    if (!fileInput || !button) return;
  
    button.addEventListener("click", async () => {
      const file = fileInput.files[0];
  
      if (!file) {
        status.textContent = "請先選擇文件。";
        return;
      }
  
      button.disabled = true;
      result.textContent = "";
  
      try {
        const data = await window.ExpenseOCR.readDocument(
          file,
          (progress) => {
            if (progress.status === "reading-page") {
              status.textContent =
                `正在讀取第 ${progress.pageNumber} / ${progress.totalPages} 頁`;
            } else if (progress.status === "recognizing text") {
              status.textContent =
                `OCR 辨識中：${Math.round((progress.progress || 0) * 100)}%`;
            }
          }
        );
  
        status.textContent = "辨識完成！";
  
        result.textContent = data.pages.map((page) => {
          return [
            `第 ${page.pageNumber} 頁（${page.source}）`,
            page.text
          ].join("\n");
        }).join("\n\n--------------------\n\n");
  
        console.log("OCR 完整結果：", data);
        console.table(data.pages.map((page) => ({
          頁數: page.pageNumber,
          辨識方式: page.source,
          文字長度: page.text.length,
          數字數量: (page.text.match(/[0-9０-９]/g) || []).length,
          辨識文字: page.text
        })));
  
      } catch (error) {
        console.error(error);
        status.textContent = `辨識失敗：${error.message}`;
  
      } finally {
        button.disabled = false;
      }
    });
  });
})();
