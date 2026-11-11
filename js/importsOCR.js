// importsOCR.js
// PDF 文字擷取 + PaddleOCR 圖片辨識

(() => {
  const PDF_WORKER_URL =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const PADDLEOCR_URL =
    "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm";

  // PDF.js worker 設定
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  }

  // PaddleOCR 初始化 Promise
  // 避免每張圖片都重新載入模型
  let paddleOCRPromise = null;

  /**
   * 建立 PaddleOCR
   */
  /*async function createOCR() {
    if (!paddleOCRPromise) {
      paddleOCRPromise = (async () => {
        const { PaddleOCR } = await import(PADDLEOCR_URL);

        const ocr = await PaddleOCR.create({
          lang: "ch",
          ocrVersion: "PP-OCRv5",
          ortOptions: {
            backend: "auto"
          }
        });

        return ocr;
      })().catch(error => {
        // 初始化失敗時允許下次重新嘗試
        paddleOCRPromise = null;
        throw error;
      });
    }

    return paddleOCRPromise;
  }*/

  //暫時測試版本
  function setOCRDebug(message) {
  
    if (typeof window.setOCRTestStatus === "function") {
      window.setOCRTestStatus(message);
    }
  
    console.log("[OCR Debug]", message);
  }
  
  async function createOCR() {
    if (!paddleOCRPromise) {
      paddleOCRPromise = (async () => {
  
        setOCRDebug("① 開始載入 PaddleOCR 套件");
  
        const { PaddleOCR } = await import(PADDLEOCR_URL);
  
        setOCRDebug("② 套件載入完成，開始初始化模型");
  
        const ocr = await PaddleOCR.create({
          lang: "ch",
          ocrVersion: "PP-OCRv5",
          ortOptions: {
            backend: "auto"
          }
        });
  
        setOCRDebug("③ PaddleOCR 初始化完成");
  
        return ocr;
  
      })().catch(error => {
  
        setOCRDebug(
          `初始化失敗：${error.message}`
        );
  
        paddleOCRPromise = null;
        throw error;
      });
    }
  
    return paddleOCRPromise;
  }
  //暫時測試版本結束
  
  /**
   * 將 Canvas 交給 PaddleOCR 辨識
   */
  async function recognizeCanvas(canvas, onProgress) {
    if (typeof onProgress === "function") {
      onProgress({
        status: "recognizing text"
      });
    }

    const ocr = await createOCR();

    const [result] = await ocr.predict(canvas);

    // 整理辨識結果
    const items = (result.items || []).map(item => {
      const poly = item.poly || [];

      const xCoordinates = poly.map(point => point[0]);
      const yCoordinates = poly.map(point => point[1]);

      return {
        text: item.text,
        confidence: item.score,
        score: item.score,
        poly,

        // 轉換成原本 Tesseract bbox 類似的格式
        bbox: {
          x0: Math.min(...xCoordinates),
          y0: Math.min(...yCoordinates),
          x1: Math.max(...xCoordinates),
          y1: Math.max(...yCoordinates)
        }
      };
    });

    return {
      text: items.map(item => item.text).join("\n"),
      items,

      // 暫時保留 words 名稱，避免其他舊程式讀取時出錯。
      // 注意：PaddleOCR 回傳的是文字區塊，不一定是單一詞語。
      words: items
    };
  }

  /**
   * 讀取圖片並執行 OCR
   */
  async function readImage(file, onProgress) {
    const bitmap = await createImageBitmap(file);

    try {
      const canvas = document.createElement("canvas");

      canvas.width = bitmap.width;
      canvas.height = bitmap.height;

      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);

      const result = await recognizeCanvas(canvas, onProgress);

      return {
        fileName: file.name,
        fileType: "image",
        totalPages: 1,
        pages: [
        {
          pageNumber: 1,
          source: "ocr",
          width: bitmap.width,
          height: bitmap.height,
          text: result.text,
          items: result.items,
          words: result.words
        }
      ]
      };

    } finally {
      bitmap.close();
    }
  }

  /**
   * 讀取 PDF
   *
   * 有文字層：使用 PDF.js 擷取文字
   * 沒有足夠文字：轉成 Canvas，再使用 PaddleOCR
   */
  async function readPDF(file, onProgress) {
    if (!window.pdfjsLib) {
      throw new Error(
        "PDF.js 尚未載入，請檢查 index.html 的 script 順序。"
      );
    }

    const buffer = await file.arrayBuffer();

    const pdf = await window.pdfjsLib.getDocument({
      data: new Uint8Array(buffer)
    }).promise;

    const pages = [];

    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages;
      pageNumber++
    ) {
      if (typeof onProgress === "function") {
        onProgress({
          status: "reading-page",
          pageNumber,
          totalPages: pdf.numPages
        });
      }

      const page = await pdf.getPage(pageNumber);
      
      /*const textContent = await page.getTextContent();

      const textItems = (textContent.items || [])
        .filter(item => item.str && item.str.trim())
        .map(item => ({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height
        }));

      const pageText = textItems
        .map(item => item.text)
        .join(" ");

      // 文字層足夠時，直接使用 PDF 原始文字
      const hasTextLayer =
        textItems.length >= 5 &&
        pageText.trim().length >= 30;

      if (hasTextLayer) {
        pages.push({
          pageNumber,
          source: "pdf-text",
          text: pageText,
          textItems,
          items: [],
          words: []
        });

        continue;
      }*/

      // 文字層不足時，改用 PaddleOCR
      const viewport = page.getViewport({
        scale: 2
      });

      const canvas = document.createElement("canvas");

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      const context = canvas.getContext("2d");

      await page.render({
        canvasContext: context,
        viewport
      }).promise;

      const result = await recognizeCanvas(canvas, onProgress);

      pages.push({
        pageNumber,
        source: "ocr",
        width: canvas.width,
        height: canvas.height,
        text: result.text,
        textItems: [],
        items: result.items,
        words: result.words
      });
    }
    return {
      fileName: file.name,
      fileType: "pdf",
      totalPages: pdf.numPages,
      pages
    };
  }

  /**
   * 對外提供的文件讀取入口
   */
  /*async function readDocument(file, onProgress) {
    if (!file) {
      throw new Error("請先選擇文件。");
    }

    const fileName = file.name.toLowerCase();

    if (
      file.type === "application/pdf" ||
      fileName.endsWith(".pdf")
    ) {
      return readPDF(file, onProgress);
    }

    if (
      file.type.startsWith("image/") ||
      /\.(jpg|jpeg|png)$/i.test(fileName)
    ) {
      return readImage(file, onProgress);
    }

    throw new Error(
      "目前只支援 PDF、JPG、JPEG、PNG 檔案。"
    );
  }*/

  //暫時測試版
  async function readDocument(file, onProgress) {
    if (!file) {
      throw new Error("請先選擇文件。");
    }
  
    const fileName = file.name.toLowerCase();
  
    setOCRDebug(`④ 開始處理文件：${file.name}`);
  
    try {
      if (
        file.type === "application/pdf" ||
        fileName.endsWith(".pdf")
      ) {
        setOCRDebug("⑤ 判定為 PDF，開始執行 PDF 辨識……");
  
        const result = await readPDF(file, onProgress);
  
        setOCRDebug("⑥ PDF 辨識完成。");
  
        return result;
      }
  
      if (
        file.type.startsWith("image/") ||
        /\.(jpg|jpeg|png)$/i.test(fileName)
      ) {
        setOCRDebug("⑤ 判定為圖片，開始執行圖片辨識……");
  
        const result = await readImage(file, onProgress);
  
        setOCRDebug("⑥ 圖片辨識完成。");
  
        return result;
      }
  
      throw new Error(
        "目前只支援 PDF、JPG、JPEG、PNG 檔案。"
      );
  
    } catch (error) {
      setOCRDebug(
        `文件處理失敗：${error.message}`
      );
  
      throw error;
    }
  }

  // 對外提供
  window.importsOCR = {
    readDocument
  };
  
  /*document.addEventListener("DOMContentLoaded", () => {
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
    status.textContent = "正在辨識中，第一次可能需要較長時間...";

    try {
      const data = await window.ExpenseOCR.readDocument(
        file,
        progress => {
          if (progress.status === "reading-page") {
            status.textContent =
              `正在讀取第 ${progress.pageNumber} / ${progress.totalPages} 頁`;
          } else if (progress.status === "recognizing text") {
            status.textContent = "正在使用 PaddleOCR 辨識...";
          }
        }
      );

      status.textContent = "辨識完成！";

      result.textContent = data.pages.map(page => {
        return [
          `第 ${page.pageNumber} 頁（${page.source}）`,
          page.text
        ].join("\n");
      }).join("\n\n--------------------\n\n");

      console.log("完整辨識結果：", data);

    } catch (error) {
      console.error(error);
      status.textContent = `辨識失敗：${error.message}`;

    } finally {
      button.disabled = false;
    }
  });
});*/

})();
