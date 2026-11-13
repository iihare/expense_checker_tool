
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const allowedExtensions = new Set(["pdf", "jpg", "jpeg", "png"]);

  const STANDARD_ITEMS = [
    "場地費",
    "場地布置費",
    "設備使用或租借費",
    "書籍資料及文宣品印刷費",
    "鐘點費",
    "出席費",
    "裁判費",
    "租車費",
    "交通費",
    "住宿費",
    "報名費",
    "保險費",
    "非經費編列基準表所編之經費"
  ];

  // ---------- 0. 匯入資料狀態 ----------

  // 匯入檔案獨立保存，不放進 appState，
  // 也不直接改動表單或經費資料。
  const documentState = {
    applicationFiles: [],
    expenseFiles: [],

    parsedApplicationDocuments: [],
    parsedExpenseDocuments: [],
    parsedExpenseRows: [],

    isProcessing: false
  };

  window.documentImportState = documentState;

  // ---------- 輔助函式 ----------

  function getExtension(fileName) {
    const parts = String(fileName || "").toLowerCase().split(".");
    return parts.length > 1 ? parts.pop() : "";
  }

  function isSupportedFile(file) {
    const extension = getExtension(file.name);
    return allowedExtensions.has(extension) && file.size > 0;
  }

  function isDuplicate(files, candidate) {
    return files.some((file) =>
      file.name === candidate.name &&
      file.size === candidate.size &&
      file.lastModified === candidate.lastModified
    );
  }

  function formatCount(count) {
    return count > 0 ? `${count} 個檔案` : "尚未選擇";
  }

  function getMimeType(file) {
    if (file.type) return file.type;

    const extension = getExtension(file.name);

    const mimeTypes = {
      pdf: "application/pdf",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png"
    };

    return mimeTypes[extension] || "application/octet-stream";
  }

  // ---------- 介面更新 ----------

  function updateImportControls() {
    const button = $("startOcrBtn");
    if (!button) return;

    button.disabled =
      documentState.isProcessing ||
      (
        documentState.applicationFiles.length === 0 &&
        documentState.expenseFiles.length === 0
      );

    button.textContent = documentState.isProcessing
      ? "辨識中……"
      : "開始辨識";

    // 只有選取經費概算表時，才顯示 API Key 輸入框。
    const apiKeyBox = $("geminiApiKeyBox");

    if (apiKeyBox) {
      apiKeyBox.style.display =
        documentState.expenseFiles.length > 0 ? "block" : "none";
    }
  }

  function setImportFeedback(message) {
    const notice = $("importNotice");
    if (!notice) return;

    let feedback = notice.querySelector(".import-processing-feedback");

    if (!feedback) {
      feedback = document.createElement("span");
      feedback.className = "import-processing-feedback";
      notice.appendChild(feedback);
    }

    feedback.textContent = message;
  }

  function renderFileList(type) {
    const isApplication = type === "application";

    const files = isApplication
      ? documentState.applicationFiles
      : documentState.expenseFiles;

    const list = $(isApplication
      ? "applicationFileList"
      : "expenseFileList");

    const count = $(isApplication
      ? "applicationFileCount"
      : "expenseFileCount");

    if (!list || !count) return;

    count.textContent = formatCount(files.length);
    list.replaceChildren();

    if (files.length === 0) {
      const empty = document.createElement("li");
      empty.className = "import-empty-files";
      empty.textContent = "尚未選擇檔案";
      list.appendChild(empty);

      updateImportControls();
      return;
    }

    files.forEach((file, index) => {
      const item = document.createElement("li");
      item.className = "import-file-item";

      const name = document.createElement("span");
      name.className = "import-file-name";
      name.textContent = file.name;
      name.title = file.name;

      const removeButton = document.createElement("button");
      removeButton.className = "import-remove-file-btn";
      removeButton.type = "button";
      removeButton.textContent = "移除";
      removeButton.setAttribute(
        "aria-label",
        `移除檔案：${file.name}`
      );

      removeButton.addEventListener("click", () => {
        files.splice(index, 1);

        if (isApplication) {
          documentState.parsedApplicationDocuments = [];
        } else {
          documentState.parsedExpenseDocuments = [];
          documentState.parsedExpenseRows = [];
        }

        renderFileList(type);
      });

      item.append(name, removeButton);
      list.appendChild(item);
    });

    updateImportControls();
  }

  function addSelectedFiles(type, selectedFiles) {
    const files = type === "application"
      ? documentState.applicationFiles
      : documentState.expenseFiles;

    let addedCount = 0;
    let unsupportedCount = 0;
    let duplicateCount = 0;

    Array.from(selectedFiles).forEach((file) => {
      if (!isSupportedFile(file)) {
        unsupportedCount++;
        return;
      }

      if (isDuplicate(files, file)) {
        duplicateCount++;
        return;
      }

      files.push(file);
      addedCount++;
    });

    if (addedCount > 0) {
      if (type === "application") {
        documentState.parsedApplicationDocuments = [];
      } else {
        documentState.parsedExpenseDocuments = [];
        documentState.parsedExpenseRows = [];
      }
    }

    renderFileList(type);

    const messages = [];

    if (addedCount) {
      messages.push(`已加入 ${addedCount} 個檔案`);
    }

    if (duplicateCount) {
      messages.push(`略過 ${duplicateCount} 個重複檔案`);
    }

    if (unsupportedCount) {
      messages.push(`略過 ${unsupportedCount} 個不支援或空白檔案`);
    }

    const notice = $("importNotice");

    if (notice && messages.length) {
      notice.querySelector(".import-selection-feedback")?.remove();

      const detail = document.createElement("span");
      detail.className = "import-selection-feedback";
      detail.textContent = messages.join("；");

      notice.appendChild(detail);
    }
  }

  // ---------- Modal ----------

  function openImportModal() {
    const backdrop = $("importModalBackdrop");
    if (!backdrop) return;

    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");

    document.body.classList.add("modal-open");

    $("closeImportModalBtn")?.focus();
  }

  function closeImportModal() {
    if (documentState.isProcessing) return;

    const backdrop = $("importModalBackdrop");
    if (!backdrop) return;

    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");

    document.body.classList.remove("modal-open");

    $("importFilesBtn")?.focus();
  }

  // ---------- 1. 申請書資料寫回 ----------

  function writeApplicationData(parsed) {
    const textFields = [
      "unitName",
      "leader",
      "registeredAddress",
      "mailingAddress"
    ];

    const amountFields = [
      "totalBudget",
      "guidelineGrant",
      "selfFund",
      "otherAgency",
      "expectedFee",
      "otherAmount"
    ];

    textFields.forEach((field) => {
      const input = $(field);
      const value = parsed[field];

      if (
        !input ||
        value === null ||
        value === undefined
      ) return;

      const text = String(value).trim();

      if (text !== "") {
        input.value = text;

        input.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      }
    });

    amountFields.forEach((field) => {
      const input = $(field);
      const value = parsed[field];

      if (
        !input ||
        value === null ||
        value === undefined ||
        !Number.isFinite(Number(value))
      ) return;

      input.value = String(value);

      input.dispatchEvent(
        new Event("input", { bubbles: true })
      );
    });
  }

  // ---------- 2. 申請書：純本地端 OCR ----------

  async function processApplicationFiles() {
    const files = [...documentState.applicationFiles];

    if (files.length === 0) return false;

    documentState.parsedApplicationDocuments = [];

    const allPages = [];
    const failedFiles = [];

    for (const file of files) {
      try {
        const result = await window.importsOCR.readDocument(file);

        if (
          !result ||
          !Array.isArray(result.pages) ||
          result.pages.length === 0
        ) {
          throw new Error("沒有取得有效的 OCR 頁面。");
        }

        allPages.push(...result.pages);

      } catch (error) {
        console.error(`申請書 OCR 失敗：${file.name}`, error);
        failedFiles.push(file.name);
      }
    }

    if (allPages.length === 0) {
      setImportFeedback(
        "申請書辨識失敗，請確認檔案內容或重新匯入。"
      );

      return false;
    }

    const combinedDocument = {
      fileName: files.map(file => file.name).join("、"),
      fileType: "application",
      totalPages: allPages.length,
      pages: allPages
    };

    let parsed;

    try {
      parsed = window.ApplicationOCRParser.parseDocument(
        combinedDocument
      );

      if (!parsed || typeof parsed !== "object") {
        throw new Error("解析結果格式不正確。");
      }

    } catch (error) {
      console.error("申請書解析失敗：", error);

      setImportFeedback(
        "申請書 OCR 已完成，但解析資料時發生錯誤。"
      );

      return false;
    }

    documentState.parsedApplicationDocuments.push(parsed);

    try {
      writeApplicationData(parsed);

    } catch (error) {
      console.error("申請書資料寫回失敗：", error);

      setImportFeedback(
        "申請書解析完成，但寫回表單時發生錯誤。"
      );

      return false;
    }

    const reviewCount = Array.isArray(parsed.needsReview)
      ? parsed.needsReview.length
      : 0;

    let message =
      `申請書辨識完成，共取得 ${allPages.length} 頁。`;

    if (reviewCount > 0) {
      message += `另有 ${reviewCount} 個欄位需要人工確認。`;
    }

    if (failedFiles.length > 0) {
      message +=
        `以下檔案辨識失敗：${failedFiles.join("、")}。`;
    }

    setImportFeedback(message);

    return true;
  }

  // ---------- 3. 輔助函式：檔案轉 Base64 ----------

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.readAsDataURL(file);

      reader.onload = () => {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");

        const base64String = commaIndex !== -1
          ? result.slice(commaIndex + 1)
          : result;

        resolve(base64String);
      };

      reader.onerror = () => {
        reject(
          reader.error || new Error("檔案讀取失敗。")
        );
      };
    });
  }

  // ---------- 4. Gemini 回傳資料整理 ----------

  function parseGeminiResponse(data) {
    const firstCandidate = Array.isArray(data.candidates)
      ? data.candidates[0]
      : null;

    const parts = firstCandidate?.content?.parts;

    const rawText = Array.isArray(parts)
      ? parts.find(part => typeof part.text === "string")?.text
      : null;

    if (!rawText) {
      throw new Error("Gemini API 未回傳任何解析內容。");
    }

    const aiRows = JSON.parse(rawText);

    if (!Array.isArray(aiRows)) {
      throw new Error("Gemini 回傳資料不是有效的陣列。");
    }

    return aiRows;
  }

  function normalizeNumber(value) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return "";
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : "";
  }

  function formatExpenseRows(aiRows, sourceFileNames) {
    return aiRows.map((row, idx) => {
      const originalItem = String(
        row.originalItem || row.item || ""
      ).trim();

      const item = STANDARD_ITEMS.includes(row.item)
        ? row.item
        : "非經費編列基準表所編之經費";

      const unitPrice = normalizeNumber(row.unitPrice);
      const quantity = normalizeNumber(row.quantity);
      const budget = normalizeNumber(row.budget);

      const grant = normalizeNumber(row.grant);
      const agency = normalizeNumber(row.agency);
      const self = normalizeNumber(row.self);
      const other = normalizeNumber(row.other);

      const missingFields = [];

      if (unitPrice === "") missingFields.push("unitPrice");
      if (quantity === "") missingFields.push("quantity");
      if (budget === "") missingFields.push("budget");

      const isUnclassified =
        item === "非經費編列基準表所編之經費";

      return {
        item,
        originalItem,

        unitPrice,
        quantity,
        budget,

        grant,
        agency,
        self,
        other,

        needsReview: missingFields.length > 0,
        needsClassification: isUnclassified,

        sourceFile: sourceFileNames,

        // 暫時使用資料索引，不代表真正的 PDF 頁碼。
        sourcePage: idx + 1,

        reviewInfo: {
          missingFields,
          lowConfidenceFields: [],
          itemConfidence: null
        }
      };
    });
  }

  // ---------- 5. 經費概算表：Gemini API ----------
 
  async function processExpenseFiles() {
    const files = [...documentState.expenseFiles];
  
    if (files.length === 0) return false;
  
    const apiKey =
      $("geminiApiKeyInput")?.value.trim() ||
      localStorage.getItem("gemini_api_key");
  
    if (!apiKey) {
      setImportFeedback(
        "請先輸入 Gemini API Key 再開始辨識經費表。"
      );
  
      return false;
    }
  
    documentState.parsedExpenseDocuments = [];
    documentState.parsedExpenseRows = [];
  
    try {
      setImportFeedback(
        `正在準備 ${files.length} 個經費表檔案並傳送至 Gemini AI 解析……`
      );
  
      // 將所有經費表檔案轉為 inline_data。
      const parts = [];
  
      for (const file of files) {
        const base64Data = await fileToBase64(file);
  
        parts.push({
          inline_data: {
            mime_type: getMimeType(file),
            data: base64Data
          }
        });
      }
  
      // Gemini 解析指示。
      const promptLines = [
        "請完整提取文件中「補助經費明細表 / 經費概算表」的所有明細項目。",
        "請排除底部的「申請本要點補助金額合計」、「活動總經費」等總計列。",
        "若明細表跨越多頁，請合併提取所有頁面的明細。",
        "注意事項：",
        "1. originalItem 請填寫表格中「經費項目」欄位的完整原始文字。",
        "2. item 請根據 originalItem 對應到最符合的標準項目清單。",
        "3. 若不屬於前 12 項基準表項目，例如文具費、競賽獎金、抽獎、雜支、工讀費等，請一律歸類為「非經費編列基準表所編之經費」。",
        "4. 金額或數量欄位若表格中為空白，請填入 null，不要自行捏造數字。",
        "5. 請注意不要將總計列誤認為一般經費明細。",
        "6. 所有金額均請回傳數字，不要加入千分位逗號或貨幣符號。",
        "7. 請依照文件原本的明細順序回傳。",
        "標準項目清單：",
        STANDARD_ITEMS.join("、")
      ];
  
      parts.push({
        text: promptLines.join("\n")
      });
  
      // 模型優先順序。
      const MODEL_FALLBACK_LIST = [
        "gemini-3.5-flash-lite",
        "gemini-3.8-flash"
      ];
  
      // Gemini 結構化輸出設定。
      const requestBody = {
        contents: [
          {
            parts
          }
        ],
  
        generationConfig: {
          responseMimeType: "application/json",
  
          responseSchema: {
            type: "ARRAY",
            description: "經費明細項目陣列",
  
            items: {
              type: "OBJECT",
  
              properties: {
                originalItem: {
                  type: "STRING",
                  description: "表格中的原始經費項目名稱"
                },
  
                item: {
                  type: "STRING",
                  enum: STANDARD_ITEMS,
                  description: "對應的標準經費項目分類"
                },
  
                unitPrice: {
                  type: "NUMBER",
                  nullable: true,
                  description: "單價"
                },
  
                quantity: {
                  type: "NUMBER",
                  nullable: true,
                  description: "數量"
                },
  
                budget: {
                  type: "NUMBER",
                  nullable: true,
                  description: "預算金額"
                },
  
                grant: {
                  type: "NUMBER",
                  nullable: true,
                  description: "申請本要點補助金額"
                },
  
                agency: {
                  type: "NUMBER",
                  nullable: true,
                  description: "他機關補助金額"
                },
  
                self: {
                  type: "NUMBER",
                  nullable: true,
                  description: "自籌款－自付經費"
                },
  
                other: {
                  type: "NUMBER",
                  nullable: true,
                  description: "自籌款－其他（民間贊助或收費）"
                }
              },
  
              required: [
                "originalItem",
                "item",
                "budget"
              ]
            }
          }
        }
      };
  
      // 儲存成功取得的 Gemini 回應。
      let data = null;
      let lastErrorMsg = "";
  
      // 逐一嘗試主要模型與備援模型。
      for (const modelName of MODEL_FALLBACK_LIST) {
  
        const url =
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
  
        // 每個模型最多呼叫兩次（第一次 + 重試一次）。
        const maxAttempts = 2;
  
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
  
          setImportFeedback(
            `正在使用 ${modelName} 辨識經費表……`
          );
  
          console.log(
            `正在呼叫 ${modelName}，第 ${attempt + 1} 次`
          );
  
          const response = await fetch(url, {
            method: "POST",
  
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
  
            body: JSON.stringify(requestBody)
          });
  
          const responseData = await response.json();
  
          // API 成功。
          if (response.ok && !responseData.error) {
            data = responseData;
  
            console.log(
              `成功使用模型完成辨識：${modelName}`
            );
  
            break;
          }
  
          lastErrorMsg =
            responseData.error?.message ||
            `HTTP 錯誤 ${response.status}`;
  
          // 429 可能是額度或速率限制，
          // 不一定能透過切換模型解決。
          if (response.status === 429) {
            throw new Error(
              `Gemini API 使用額度或速率受到限制（429）：${lastErrorMsg}`
            );
          }
  
          // 只針對暫時性伺服器錯誤進行重試。
          const retryableStatuses = [
            500,
            502,
            503,
            504
          ];
  
          if (retryableStatuses.includes(response.status)) {
  
            // 還有重試機會時，等待後再次呼叫同一模型。
            if (attempt < maxAttempts - 1) {
  
              const delay = 1000 * (attempt + 1);
  
              console.warn(
                `${modelName} 發生錯誤 (${response.status})，` +
                `${delay / 1000} 秒後重試。`
              );
  
              setImportFeedback(
                `${modelName} 暫時忙碌，等待後重新嘗試……`
              );
  
              await new Promise(resolve =>
                setTimeout(resolve, delay)
              );
  
              continue;
            }
  
            // 同一模型重試仍失敗，跳出內層迴圈，
            // 改用下一個備援模型。
            console.warn(
              `${modelName} 重試後仍無法使用，準備切換備援模型。`
            );
  
            break;
          }
  
          // 其他錯誤直接中止，例如 API Key 錯誤、
          // 請求格式錯誤或模型不存在。
          throw new Error(
            `${modelName} API 呼叫失敗：${lastErrorMsg}`
          );
        }
  
        // 已取得成功結果，不再呼叫其他模型。
        if (data) break;
      }
  
      // 所有模型都失敗。
      if (!data) {
        throw new Error(
          lastErrorMsg ||
          "所有 Gemini 模型目前皆無法使用，請稍後再試。"
        );
      }
  
      // 取得 AI 回傳資料。
      const aiRows = parseGeminiResponse(data);
  
      const sourceFileNames = files
        .map(file => file.name)
        .join("、");
  
      // 轉換為原本 ExpenseOCRParser 相容的資料格式。
      const formattedRows = formatExpenseRows(
        aiRows,
        sourceFileNames
      );
  
      documentState.parsedExpenseDocuments.push({
        fileName: sourceFileNames,
  
        result: {
          success: true,
          rows: formattedRows
        }
      });
  
      documentState.parsedExpenseRows = formattedRows;
  
      // 呼叫原本寫好的經費表寫回函式。
      if (typeof window.importExpenseRows !== "function") {
        throw new Error(
          "找不到 importExpenseRows()，請確認經費表寫回函式是否已載入。"
        );
      }
  
      window.importExpenseRows(formattedRows);
  
      setImportFeedback(
        `經費表辨識完成！共取得 ${formattedRows.length} 筆經費資料。`
      );
  
      console.log("Gemini 解析結果：", formattedRows);
  
      return true;
  
    } catch (error) {
      console.error(
        "經費表 Gemini API 處理失敗：",
        error
      );
  
      setImportFeedback(
        `經費表辨識失敗：${error.message}`
      );
  
      return false;
    }
  }

  // ---------- 6. 統一執行 OCR ----------

  async function startOCR() {
    if (documentState.isProcessing) return;

    const hasApplicationFiles =
      documentState.applicationFiles.length > 0;

    const hasExpenseFiles =
      documentState.expenseFiles.length > 0;

    if (!hasApplicationFiles && !hasExpenseFiles) {
      setImportFeedback("請先選擇要辨識的檔案。");
      return;
    }

    // 只有選擇經費概算表時，才檢查及儲存 API Key。
    if (hasExpenseFiles) {
      const apiKeyInput = $("geminiApiKeyInput");
      const apiKey = apiKeyInput?.value.trim();

      if (!apiKey) {
        setImportFeedback(
          "辨識經費概算表需要輸入 Gemini API Key。"
        );

        apiKeyInput?.focus();
        return;
      }

      localStorage.setItem("gemini_api_key", apiKey);
    }

    documentState.isProcessing = true;
    updateImportControls();

    let applicationSucceeded = false;
    let expenseSucceeded = false;

    try {
      // 1. 申請書：純本地端 OCR。
      if (hasApplicationFiles) {
        try {
          applicationSucceeded =
            await processApplicationFiles();

        } catch (error) {
          console.error("申請書處理失敗：", error);

          setImportFeedback(
            "申請書處理時發生未預期的錯誤。"
          );
        }
      }

      // 2. 經費表：Gemini API。
      if (hasExpenseFiles) {
        try {
          expenseSucceeded =
            await processExpenseFiles();

        } catch (error) {
          console.error("經費表處理失敗：", error);

          setImportFeedback(
            "經費表處理時發生未預期的錯誤。"
          );
        }
      }

    } finally {
      documentState.isProcessing = false;

      updateImportControls();

      // 只有成功的檔案才清除。
      if (applicationSucceeded) {
        clearApplicationFiles();
      }

      if (expenseSucceeded) {
        clearExpenseFiles();
      }

      const hasRemainingFiles =
        documentState.applicationFiles.length > 0 ||
        documentState.expenseFiles.length > 0;

      if (!hasRemainingFiles) {
        closeImportModal();
      }
    }
  }

  // ---------- 7. 清除檔案 ----------

  function clearApplicationFiles() {
    documentState.applicationFiles = [];

    const input = $("applicationFilesInput");
    if (input) input.value = "";

    renderFileList("application");
  }

  function clearExpenseFiles() {
    documentState.expenseFiles = [];

    const input = $("expenseFilesInput");
    if (input) input.value = "";

    renderFileList("expense");
  }

  function clearAllFiles() {
    if (documentState.isProcessing) return;

    documentState.applicationFiles = [];
    documentState.expenseFiles = [];

    documentState.parsedApplicationDocuments = [];
    documentState.parsedExpenseDocuments = [];
    documentState.parsedExpenseRows = [];

    const applicationInput = $("applicationFilesInput");
    const expenseInput = $("expenseFilesInput");

    if (applicationInput) applicationInput.value = "";
    if (expenseInput) expenseInput.value = "";

    renderFileList("application");
    renderFileList("expense");

    updateImportControls();

    const notice = $("importNotice");

    if (notice) {
      notice.querySelector(".import-selection-feedback")?.remove();
      notice.querySelector(".import-processing-feedback")?.remove();
    }
  }

  // ---------- 8. 初始化 ----------

  function initialize() {
    // 自動帶入上次儲存在瀏覽器的 API Key。
    const savedKey = localStorage.getItem("gemini_api_key");

    if (savedKey && $("geminiApiKeyInput")) {
      $("geminiApiKeyInput").value = savedKey;
    }

    // 按鈕事件。
    $("importFilesBtn")?.addEventListener(
      "click",
      openImportModal
    );

    $("closeImportModalBtn")?.addEventListener(
      "click",
      closeImportModal
    );

    $("cancelImportModalBtn")?.addEventListener(
      "click",
      closeImportModal
    );

    $("clearImportFilesBtn")?.addEventListener(
      "click",
      clearAllFiles
    );

    $("startOcrBtn")?.addEventListener(
      "click",
      startOCR
    );

    // 申請書檔案選取。
    $("applicationFilesInput")?.addEventListener(
      "change",
      (event) => {
        addSelectedFiles(
          "application",
          event.target.files || []
        );

        event.target.value = "";
      }
    );

    // 經費表檔案選取。
    $("expenseFilesInput")?.addEventListener(
      "change",
      (event) => {
        addSelectedFiles(
          "expense",
          event.target.files || []
        );

        event.target.value = "";
      }
    );

    // 點擊 Modal 外部關閉。
    $("importModalBackdrop")?.addEventListener(
      "click",
      (event) => {
        if (event.target === event.currentTarget) {
          closeImportModal();
        }
      }
    );

    // ESC 關閉 Modal。
    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        $("importModalBackdrop")?.classList.contains("open")
      ) {
        closeImportModal();
      }
    });

    // 初始畫面。
    renderFileList("application");
    renderFileList("expense");

    updateImportControls();
  }

  // ---------- 啟動 ----------

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initialize,
      { once: true }
    );

  } else {
    initialize();
  }

})();
